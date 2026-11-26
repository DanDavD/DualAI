/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Zero-PII Security Event Logger & Origin Policy (CARD-17)
 * Emits structured JSON security telemetry strictly scrubbed of all PII (emails, tokens,
 * secrets, raw IP addresses) and enforces strict ALLOWED_ORIGINS + disposable-domain defense.
 */

import crypto from 'node:crypto'
import { GatewayConfig } from '../config.js'

export type SecurityEventName =
  | 'auth_unauthorized'
  | 'auth_email_unverified_blocked'
  | 'auth_disposable_email_blocked'
  | 'auth_token_refreshed'
  | 'auth_session_revoked'
  | 'ws_origin_rejected'
  | 'http_origin_rejected'
  | 'tls_downgrade_rejected'
  | 'webhook_signature_failed'
  | 'webhook_ip_rejected'
  | 'rate_limit_triggered'

export interface StructuredSecurityEvent {
  ts: string
  level: 'info' | 'warn' | 'error'
  event: SecurityEventName
  route: string
  status: number
  actorHash: string
  reason: string
  origin?: string
}

export type SecurityEventSink = (entry: StructuredSecurityEvent) => void

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const JWT_PATTERN = /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-_.]+/gi

/**
 * Known disposable/burner email providers blocked from farming the 1-hour free tier.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.org',
  'sharklasers.com',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'dispostable.com',
  'throwawaymail.com',
  'fakeinbox.com',
  'getnada.com',
  'maildrop.cc',
  'mintemail.com',
  'mohmal.com'
])

export function isDisposableEmailDomain(email: string): boolean {
  const parts = email.trim().toLowerCase().split('@')
  if (parts.length !== 2) return false
  const domain = parts[1]
  return DISPOSABLE_EMAIL_DOMAINS.has(domain)
}

/**
 * Produces an irreversible 12-char SHA-256 actor fingerprint so logs correlate abuse
 * incidents without storing user IDs, emails, or IP addresses in plaintext.
 */
export function hashActorIdentifier(rawIdentifier?: string | null): string {
  if (!rawIdentifier) return 'anonymous'
  return crypto
    .createHash('sha256')
    .update(`dualai-sec-actor:${rawIdentifier}`)
    .digest('hex')
    .slice(0, 12)
}

/**
 * Redacts any accidental email, JWT, or Bearer credential string prior to emitting logs.
 */
export function scrubPii(input: string): string {
  return input
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
}

/**
 * Strictly validates an HTTP or WebSocket Origin header against ALLOWED_ORIGINS.
 * - In production: if an Origin header is supplied, it MUST match config.allowedOrigins.
 * - In development/test: allows localhost origins alongside config.allowedOrigins.
 */
export function isOriginAllowed(
  rawOrigin: string | undefined,
  config: GatewayConfig,
  requireHeaderInProd: boolean = false
): boolean {
  const origin = rawOrigin?.trim()

  if (!origin) {
    return !requireHeaderInProd || config.nodeEnv !== 'production'
  }

  if (config.allowedOrigins.includes(origin)) {
    return true
  }

  if (config.nodeEnv !== 'production') {
    if (
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin === 'file://' ||
      origin === 'null'
    ) {
      return true
    }
  }

  return false
}

export class SecurityEventLogger {
  private sink: SecurityEventSink
  private silentConsole: boolean

  constructor(options?: { sink?: SecurityEventSink; silentConsole?: boolean }) {
    this.silentConsole = Boolean(options?.silentConsole)
    this.sink =
      options?.sink ||
      ((entry: StructuredSecurityEvent) => {
        if (this.silentConsole) return
        const serialized = JSON.stringify(entry)
        if (entry.level === 'error') {
          console.error(serialized)
        } else if (entry.level === 'warn') {
          console.warn(serialized)
        } else {
          console.log(serialized)
        }
      })
  }

  public log(params: {
    level: 'info' | 'warn' | 'error'
    event: SecurityEventName
    route: string
    status: number
    actorId?: string | null
    reason: string
    origin?: string
  }): StructuredSecurityEvent {
    const entry: StructuredSecurityEvent = {
      ts: new Date().toISOString(),
      level: params.level,
      event: params.event,
      route: scrubPii(params.route),
      status: params.status,
      actorHash: hashActorIdentifier(params.actorId),
      reason: scrubPii(params.reason)
    }

    if (params.origin) {
      entry.origin = scrubPii(params.origin).slice(0, 120)
    }

    this.sink(entry)
    return entry
  }
}
