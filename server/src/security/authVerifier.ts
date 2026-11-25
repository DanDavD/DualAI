/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Cryptographic Auth Verifier (CARD-17 Hardened)
 * Authenticates every HTTP and WebSocket request using Bearer JWTs.
 * - Production: Authoritative verification against Supabase Auth (/auth/v1/user) with
 *   email_confirmed_at check and short TTL cache.
 * - Non-Production Local Dev: Constant-time HMAC-SHA256 signed JWT (strictly blocked in production).
 * - Server-Side Revocation: Revoked token digests are denied immediately across HTTP & WebSocket.
 */

import crypto from 'node:crypto'
import { GatewayConfig } from '../config.js'

export interface AuthenticatedUser {
  userId: string
  email: string
  emailVerified: boolean
  authMode: 'supabase' | 'local_dev'
  expiresAtMs?: number
}

interface CachedAuthEntry {
  user: AuthenticatedUser
  expiresAtMs: number
}

interface DevJwtPayload {
  sub: string
  email: string
  email_verified?: boolean
  iat: number
  exp: number
  iss: string
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const mod = padded.length % 4
  const suffix = mod === 0 ? '' : '='.repeat(4 - mod)
  return Buffer.from(padded + suffix, 'base64').toString('utf-8')
}

export class AuthVerifier {
  private config: GatewayConfig
  private cache: Map<string, CachedAuthEntry> = new Map()
  private revokedTokens: Map<string, number> = new Map()
  private readonly cacheTtlMs = 45_000
  private readonly defaultRevocationTtlMs = 12 * 60 * 60 * 1000

  constructor(config: GatewayConfig) {
    this.config = config
  }

  public extractBearerToken(authHeader?: string | string[]): string | null {
    const header = Array.isArray(authHeader) ? authHeader[0] : authHeader
    if (!header || typeof header !== 'string') return null
    const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(
      header.trim()
    )
    return match ? match[1] : null
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex')
  }

  private pruneRevokedTokens(): void {
    const now = Date.now()
    for (const [digest, expMs] of this.revokedTokens.entries()) {
      if (expMs <= now) {
        this.revokedTokens.delete(digest)
      }
    }
  }

  /**
   * Immediately revokes a Bearer JWT server-side, clearing auth cache and denying any replay.
   * When Supabase Auth is configured, also invokes upstream /auth/v1/logout.
   */
  public async revokeSessionToken(token: string | null, expiresAtMs?: number): Promise<void> {
    if (!token) return
    this.pruneRevokedTokens()
    const digest = this.hashToken(token)
    this.cache.delete(digest)
    const retainUntil = Math.max(
      Date.now() + 60_000,
      expiresAtMs ?? Date.now() + this.defaultRevocationTtlMs
    )
    this.revokedTokens.set(digest, retainUntil)

    if (this.config.supabaseUrl && this.config.supabaseServiceRoleKey) {
      try {
        const url = `${this.config.supabaseUrl.replace(/\/$/, '')}/auth/v1/logout`
        await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: this.config.supabaseServiceRoleKey
          }
        })
      } catch {
        // Local denylist already blocks replay immediately even if upstream logout is unreachable
      }
    }
  }

  public isTokenRevoked(token: string): boolean {
    const digest = this.hashToken(token)
    const exp = this.revokedTokens.get(digest)
    if (!exp) return false
    if (exp <= Date.now()) {
      this.revokedTokens.delete(digest)
      return false
    }
    return true
  }

  /**
   * Mints a signed local development JWT. Strictly forbidden when NODE_ENV=production.
   */
  public mintDevSessionToken(
    email: string,
    explicitUserId?: string,
    options?: { emailVerified?: boolean; ttlSeconds?: number }
  ): {
    accessToken: string
    user: AuthenticatedUser
    expiresAtMs: number
  } {
    if (this.config.nodeEnv === 'production') {
      throw new Error('Local dev token minting is strictly prohibited in production.')
    }

    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Valid email address required.')
    }

    const emailVerified = options?.emailVerified ?? true
    const ttlSeconds = Math.max(60, Math.min(60 * 60 * 24, options?.ttlSeconds ?? 60 * 60 * 12))

    const deterministicHash = crypto.createHash('sha256').update(cleanEmail).digest('hex')
    const userId =
      explicitUserId ||
      `${deterministicHash.slice(0, 8)}-${deterministicHash.slice(8, 12)}-4${deterministicHash.slice(13, 16)}-a${deterministicHash.slice(17, 20)}-${deterministicHash.slice(20, 32)}`

    const nowSec = Math.floor(Date.now() / 1000)
    const expSec = nowSec + ttlSeconds
    const headerPart = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payloadPart = base64UrlEncode(
      JSON.stringify({
        sub: userId,
        email: cleanEmail,
        email_verified: emailVerified,
        iat: nowSec,
        exp: expSec,
        iss: 'dualai-local-dev'
      } satisfies DevJwtPayload)
    )

    const signingInput = `${headerPart}.${payloadPart}`
    const signature = base64UrlEncode(
      crypto.createHmac('sha256', this.config.devLocalAuthSecret).update(signingInput).digest()
    )

    return {
      accessToken: `${signingInput}.${signature}`,
      user: {
        userId,
        email: cleanEmail,
        emailVerified,
        authMode: 'local_dev',
        expiresAtMs: expSec * 1000
      },
      expiresAtMs: expSec * 1000
    }
  }

  public async verifyToken(token: string | null): Promise<AuthenticatedUser | null> {
    if (!token) return null

    const tokenDigest = this.hashToken(token)

    // Always check server-side revocation denylist BEFORE returning cached auth entries
    const revokedUntil = this.revokedTokens.get(tokenDigest)
    if (revokedUntil && revokedUntil > Date.now()) {
      return null
    }

    const cached = this.cache.get(tokenDigest)
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.user
    }

    // 1. Authoritative Supabase Auth verification when configured
    if (this.config.supabaseUrl && this.config.supabaseServiceRoleKey) {
      const supabaseUser = await this.verifySupabaseToken(token)
      if (supabaseUser) {
        this.cache.set(tokenDigest, {
          user: supabaseUser,
          expiresAtMs: Date.now() + this.cacheTtlMs
        })
        return supabaseUser
      }
      if (this.config.nodeEnv === 'production') {
        return null
      }
    }

    // 2. Non-production local HMAC JWT verification
    if (this.config.nodeEnv !== 'production') {
      const devUser = this.verifyDevToken(token)
      if (devUser) {
        this.cache.set(tokenDigest, {
          user: devUser,
          expiresAtMs: Date.now() + this.cacheTtlMs
        })
        return devUser
      }
    }

    return null
  }

  private async verifySupabaseToken(token: string): Promise<AuthenticatedUser | null> {
    if (!this.config.supabaseUrl || !this.config.supabaseServiceRoleKey) return null

    try {
      const url = `${this.config.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: this.config.supabaseServiceRoleKey
        }
      })

      if (!response.ok) return null
      const data = (await response.json()) as {
        id?: string
        email?: string
        email_confirmed_at?: string | null
        confirmed_at?: string | null
      }
      if (!data.id || !data.email) return null

      const emailVerified = Boolean(data.email_confirmed_at || data.confirmed_at)

      return {
        userId: data.id,
        email: data.email,
        emailVerified,
        authMode: 'supabase'
      }
    } catch {
      return null
    }
  }

  private verifyDevToken(token: string): AuthenticatedUser | null {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerPart, payloadPart, providedSig] = parts

    const signingInput = `${headerPart}.${payloadPart}`
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', this.config.devLocalAuthSecret).update(signingInput).digest()
    )

    const providedBuf = Buffer.from(providedSig)
    const expectedBuf = Buffer.from(expectedSig)
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return null
    }

    try {
      const payload = JSON.parse(base64UrlDecode(payloadPart)) as Partial<DevJwtPayload>
      const nowSec = Math.floor(Date.now() / 1000)
      if (
        !payload.sub ||
        !payload.email ||
        typeof payload.exp !== 'number' ||
        payload.exp <= nowSec ||
        payload.iss !== 'dualai-local-dev'
      ) {
        return null
      }

      return {
        userId: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified !== false,
        authMode: 'local_dev',
        expiresAtMs: payload.exp * 1000
      }
    } catch {
      return null
    }
  }
}
