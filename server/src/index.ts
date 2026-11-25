/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Main HTTP & WebSocket Entrypoint (CARD-17 Hardened)
 * Sole architectural owner of Soniox, Deepgram, Gemini, Supabase Service Role, and Billing secrets.
 * Enforces:
 * - Strict ALLOWED_ORIGINS verification on HTTP and WebSocket upgrades
 * - TLS / HSTS security headers in production
 * - Verified-email gating before activating free-tier live streaming or inference
 * - Silent JWT refresh & server-side session revocation on Sign Out
 * - Structured Zero-PII security event logging
 */

import http, { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { GatewayConfig, loadGatewayConfig } from './config.js'
import { AuthVerifier } from './security/authVerifier.js'
import { GatewayRateLimiter } from './security/rateLimiter.js'
import {
  SecurityEventLogger,
  SecurityEventSink,
  isDisposableEmailDomain,
  isOriginAllowed
} from './security/securityLogger.js'
import { PLAN_CATALOG, QuotaStore, createQuotaStore } from './quota/quotaStore.js'
import { BillingVerifier } from './billing/billingVerifier.js'
import { handleSttWebSocketProxy } from './proxy/deepgramWsProxy.js'
import { handleSonioxWebSocketProxy } from './proxy/sonioxWsProxy.js'
import { handleGeminiTranslateStream, TranslateProxyPayload } from './proxy/geminiStreamProxy.js'

const MAX_JSON_BODY_BYTES = 64 * 1024 // 64 KB strict cap

export interface RunningGatewayServer {
  server: http.Server
  wss: WebSocketServer
  port: number
  baseUrl: string
  wsUrl: string
  authVerifier: AuthVerifier
  quotaStore: QuotaStore
  close: () => Promise<void>
}

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0

    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', (err) => reject(err))
  })
}

function applySecurityHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  config: GatewayConfig
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site')

  const forwardedProto = req.headers['x-forwarded-proto']
  const isHttps =
    config.nodeEnv === 'production' ||
    forwardedProto === 'https' ||
    (Array.isArray(forwardedProto) && forwardedProto.includes('https'))

  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }

  const origin = req.headers.origin
  if (origin && isOriginAllowed(origin, config, false)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  if (res.writableEnded) return
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export async function createGatewayServer(
  overrides?: Partial<GatewayConfig> & {
    quotaStore?: QuotaStore
    rateLimiter?: GatewayRateLimiter
    onSecurityEvent?: SecurityEventSink
  }
): Promise<RunningGatewayServer> {
  const {
    quotaStore: customQuotaStore,
    rateLimiter: customRateLimiter,
    onSecurityEvent,
    ...configOverrides
  } = overrides || {}

  const config = loadGatewayConfig(configOverrides)
  const authVerifier = new AuthVerifier(config)
  const quotaStore = customQuotaStore || createQuotaStore(config)
  const rateLimiter = customRateLimiter || new GatewayRateLimiter()
  const billingVerifier = new BillingVerifier(config, quotaStore)
  const securityLogger = new SecurityEventLogger({
    sink: onSecurityEvent,
    silentConsole: config.nodeEnv === 'test' && !onSecurityEvent
  })

  const server = http.createServer(async (req, res) => {
    applySecurityHeaders(req, res, config)

    const parsedUrl = new URL(req.url || '/', 'http://localhost')
    const pathname = parsedUrl.pathname
    const clientIp = req.socket.remoteAddress || 'unknown'
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined

    // Enforce TLS in production when behind reverse proxy terminating TLS
    if (config.nodeEnv === 'production') {
      const forwardedProto = req.headers['x-forwarded-proto']
      const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto
      if (proto && proto.toLowerCase() === 'http') {
        securityLogger.log({
          level: 'warn',
          event: 'tls_downgrade_rejected',
          route: pathname,
          status: 426,
          actorId: clientIp,
          reason: 'Plaintext HTTP request rejected in production'
        })
        sendJson(res, 426, {
          code: 'TLS_REQUIRED',
          message: 'HTTPS is strictly required in production.'
        })
        return
      }

      // Enforce strict ALLOWED_ORIGINS whenever a browser/Electron Origin header is present
      if (originHeader && !isOriginAllowed(originHeader, config, true)) {
        securityLogger.log({
          level: 'warn',
          event: 'http_origin_rejected',
          route: pathname,
          status: 403,
          actorId: clientIp,
          reason: 'Origin not present in ALLOWED_ORIGINS',
          origin: originHeader
        })
        sendJson(res, 403, {
          code: 'ORIGIN_NOT_ALLOWED',
          message: 'Request origin is not authorized.'
        })
        return
      }
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Global IP rate-limit guard
    const ipLimit = rateLimiter.consume(`ip:${clientIp}`, 1)
    if (!ipLimit.allowed) {
      securityLogger.log({
        level: 'warn',
        event: 'rate_limit_triggered',
        route: pathname,
        status: 429,
        actorId: clientIp,
        reason: 'IP request rate limit exceeded'
      })
      res.setHeader('Retry-After', String(ipLimit.retryAfterSec))
      sendJson(res, 429, {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please slow down.'
      })
      return
    }

    // 1. Public Health & Plan Catalog (ZERO secrets ever exposed)
    if (req.method === 'GET' && pathname === '/v1/health') {
      sendJson(res, 200, {
        status: 'ok',
        mode: config.nodeEnv,
        activeEngine: config.sonioxApiKey ? 'soniox-unified' : 'deepgram-gemini',
        sonioxConfigured: Boolean(config.sonioxApiKey),
        sttConfigured: Boolean(config.sonioxApiKey || config.deepgramApiKey),
        translationConfigured: Boolean(config.sonioxApiKey || config.geminiApiKey),
        supabaseAuthConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
        msStoreConfigured: Boolean(
          config.msStoreTenantId && config.msStoreClientId && config.msStoreClientSecret
        )
      })
      return
    }

    if (req.method === 'GET' && pathname === '/v1/plans') {
      sendJson(res, 200, { plans: Object.values(PLAN_CATALOG) })
      return
    }

    // 2. Non-Production Local Dev Sign-In (strictly 404 when NODE_ENV=production)
    if (req.method === 'POST' && pathname === '/v1/auth/dev-signin') {
      if (config.nodeEnv === 'production') {
        sendJson(res, 404, { code: 'NOT_FOUND', message: 'Endpoint not available.' })
        return
      }
      try {
        const raw = await readRawBody(req, MAX_JSON_BODY_BYTES)
        const parsed = JSON.parse(raw.toString('utf-8')) as {
          email?: string
          emailVerified?: boolean
          ttlSeconds?: number
        }
        if (!parsed.email) {
          sendJson(res, 400, { code: 'INVALID_EMAIL', message: 'Email is required.' })
          return
        }
        if (isDisposableEmailDomain(parsed.email)) {
          securityLogger.log({
            level: 'warn',
            event: 'auth_disposable_email_blocked',
            route: pathname,
            status: 403,
            actorId: clientIp,
            reason: 'Disposable email provider blocked from free-tier signup'
          })
          sendJson(res, 403, {
            code: 'DISPOSABLE_EMAIL_NOT_ALLOWED',
            message: 'Disposable email addresses cannot be used to activate a free-tier account.'
          })
          return
        }
        const session = authVerifier.mintDevSessionToken(parsed.email, undefined, {
          emailVerified: parsed.emailVerified ?? true,
          ttlSeconds: parsed.ttlSeconds
        })
        const quota = await quotaStore.getOrCreateUserQuota(session.user.userId)
        sendJson(res, 200, {
          accessToken: session.accessToken,
          expiresAtMs: session.expiresAtMs,
          user: session.user,
          quota
        })
      } catch (err) {
        sendJson(res, 400, {
          code: 'AUTH_ERROR',
          message: err instanceof Error ? err.message : 'Unable to issue local dev session.'
        })
      }
      return
    }

    // 3. Cross-Platform Billing Webhook (PayPal / Paddle - verified via HMAC-SHA256)
    if (req.method === 'POST' && pathname === '/v1/billing/webhook') {
      try {
        const raw = await readRawBody(req, MAX_JSON_BODY_BYTES)
        const sigHeader = req.headers['x-dualai-signature']
        const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader

        if (!billingVerifier.verifyWebhookSignature(raw, sig)) {
          securityLogger.log({
            level: 'warn',
            event: 'webhook_signature_failed',
            route: pathname,
            status: 401,
            actorId: clientIp,
            reason: 'Invalid HMAC-SHA256 billing webhook signature'
          })
          sendJson(res, 401, {
            code: 'INVALID_WEBHOOK_SIGNATURE',
            message: 'Cryptographic webhook signature verification failed.'
          })
          return
        }

        const body = JSON.parse(raw.toString('utf-8')) as {
          provider?: 'paypal' | 'paddle'
          transactionId?: string
          userId?: string
          planId?: string
        }

        if (
          (body.provider !== 'paypal' && body.provider !== 'paddle') ||
          !body.transactionId ||
          !body.userId ||
          !body.planId
        ) {
          sendJson(res, 400, { code: 'INVALID_WEBHOOK_PAYLOAD', message: 'Malformed webhook body.' })
          return
        }

        const result = await billingVerifier.processVerifiedWebhook({
          provider: body.provider,
          transactionId: body.transactionId,
          userId: body.userId,
          planId: body.planId
        })
        sendJson(res, result.verified ? 200 : 400, result)
      } catch {
        sendJson(res, 400, { code: 'WEBHOOK_PARSE_ERROR', message: 'Invalid webhook payload.' })
      }
      return
    }

    // 4. All Remaining Routes Require Verified Bearer JWT
    const token = authVerifier.extractBearerToken(req.headers.authorization)
    const user = await authVerifier.verifyToken(token)
    if (!user) {
      securityLogger.log({
        level: 'warn',
        event: 'auth_unauthorized',
        route: pathname,
        status: 401,
        actorId: clientIp,
        reason: 'Missing, expired, forged, or revoked Bearer token'
      })
      sendJson(res, 401, {
        code: 'UNAUTHORIZED',
        message: 'Valid Bearer authentication token required.'
      })
      return
    }

    const userLimit = rateLimiter.consume(`user:${user.userId}`, 1)
    if (!userLimit.allowed) {
      securityLogger.log({
        level: 'warn',
        event: 'rate_limit_triggered',
        route: pathname,
        status: 429,
        actorId: user.userId,
        reason: 'Authenticated user rate limit exceeded'
      })
      res.setHeader('Retry-After', String(userLimit.retryAfterSec))
      sendJson(res, 429, {
        code: 'USER_RATE_LIMITED',
        message: 'Account request rate limit exceeded.'
      })
      return
    }

    // POST /v1/auth/signout (Server-side immediate JWT revocation + upstream Supabase logout)
    if (req.method === 'POST' && pathname === '/v1/auth/signout') {
      await authVerifier.revokeSessionToken(token, user.expiresAtMs)
      securityLogger.log({
        level: 'info',
        event: 'auth_session_revoked',
        route: pathname,
        status: 200,
        actorId: user.userId,
        reason: 'Session revoked server-side on sign out'
      })
      sendJson(res, 200, { revoked: true })
      return
    }

    // POST /v1/auth/refresh (Silent JWT refresh preventing mid-session disconnects on 2h+ calls)
    if (req.method === 'POST' && pathname === '/v1/auth/refresh') {
      if (user.authMode === 'local_dev' && config.nodeEnv !== 'production') {
        const refreshed = authVerifier.mintDevSessionToken(user.email, user.userId, {
          emailVerified: user.emailVerified
        })
        securityLogger.log({
          level: 'info',
          event: 'auth_token_refreshed',
          route: pathname,
          status: 200,
          actorId: user.userId,
          reason: 'Silent session JWT rotated cleanly'
        })
        sendJson(res, 200, {
          accessToken: refreshed.accessToken,
          expiresAtMs: refreshed.expiresAtMs,
          user: refreshed.user
        })
        return
      }
      // Supabase sessions refresh directly via Supabase refresh_token; return verified status
      sendJson(res, 200, {
        user: {
          userId: user.userId,
          email: user.email,
          emailVerified: user.emailVerified,
          authMode: user.authMode
        }
      })
      return
    }

    // GET /v1/account/quota
    if (req.method === 'GET' && pathname === '/v1/account/quota') {
      try {
        const quota = await quotaStore.getOrCreateUserQuota(user.userId)
        sendJson(res, 200, {
          user: {
            userId: user.userId,
            email: user.email,
            emailVerified: user.emailVerified
          },
          quota,
          plans: Object.values(PLAN_CATALOG)
        })
      } catch {
        sendJson(res, 500, { code: 'QUOTA_FETCH_ERROR', message: 'Unable to retrieve quota.' })
      }
      return
    }

    // POST /v1/translate (Streaming Gemini SSE Proxy - blocks unverified emails!)
    if (req.method === 'POST' && pathname === '/v1/translate') {
      if (!user.emailVerified) {
        securityLogger.log({
          level: 'warn',
          event: 'auth_email_unverified_blocked',
          route: pathname,
          status: 403,
          actorId: user.userId,
          reason: 'Unverified email account blocked from live translation'
        })
        sendJson(res, 403, {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email address before activating live interpretation.'
        })
        return
      }

      try {
        const raw = await readRawBody(req, MAX_JSON_BODY_BYTES)
        const payload = JSON.parse(raw.toString('utf-8')) as TranslateProxyPayload
        await handleGeminiTranslateStream({ payload, res, user, config, quotaStore })
      } catch (err) {
        if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
          sendJson(res, 413, {
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Request body exceeds 64KB limit.'
          })
          return
        }
        sendJson(res, 400, { code: 'INVALID_JSON', message: 'Invalid JSON request payload.' })
      }
      return
    }

    // POST /v1/billing/microsoft-store/verify (Windows MSIX Native Store Receipt Verification)
    if (req.method === 'POST' && pathname === '/v1/billing/microsoft-store/verify') {
      try {
        const raw = await readRawBody(req, MAX_JSON_BODY_BYTES)
        const body = JSON.parse(raw.toString('utf-8')) as {
          storeIdKey?: string
          productId?: string
          transactionId?: string
        }
        const result = await billingVerifier.verifyMicrosoftStoreEntitlement({
          userId: user.userId,
          storeIdKey: body.storeIdKey || '',
          productId: body.productId || '',
          transactionId: body.transactionId
        })
        sendJson(res, result.verified ? 200 : 400, result)
      } catch {
        sendJson(res, 400, {
          code: 'INVALID_REQUEST',
          message: 'Invalid Microsoft Store receipt body.'
        })
      }
      return
    }

    sendJson(res, 404, { code: 'NOT_FOUND', message: 'Route not found.' })
  })

  // Zero-Trust WebSocket Upgrade Handler (/v1/stt)
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    handleProtocols: (protocols: Set<string>) => {
      if (protocols.has('dualai-auth')) return 'dualai-auth'
      return false
    }
  })

  server.on('upgrade', async (req, socket, head) => {
    const parsedUrl = new URL(req.url || '/', 'http://localhost')
    if (parsedUrl.pathname !== '/v1/stt') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    const clientIp = req.socket.remoteAddress || 'unknown'
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined

    // Enforce strict WebSocket Origin allowlist in production (CSWSH defense)
    if (config.nodeEnv === 'production' && !isOriginAllowed(originHeader, config, true)) {
      securityLogger.log({
        level: 'warn',
        event: 'ws_origin_rejected',
        route: '/v1/stt',
        status: 403,
        actorId: clientIp,
        reason: 'WebSocket Origin rejected by ALLOWED_ORIGINS policy',
        origin: originHeader || 'missing'
      })
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    // Accept Bearer JWT via Authorization header OR Sec-WebSocket-Protocol ['dualai-auth', <jwt>]
    // Never accept tokens in URL query strings so access logs never capture credentials
    let token = authVerifier.extractBearerToken(req.headers.authorization)
    if (!token) {
      const protocolHeader = req.headers['sec-websocket-protocol']
      if (typeof protocolHeader === 'string') {
        const parts = protocolHeader.split(',').map((p) => p.trim())
        const authIdx = parts.indexOf('dualai-auth')
        if (authIdx >= 0 && parts[authIdx + 1]) {
          token = parts[authIdx + 1]
        }
      }
    }

    const user = await authVerifier.verifyToken(token)
    if (!user) {
      securityLogger.log({
        level: 'warn',
        event: 'auth_unauthorized',
        route: '/v1/stt',
        status: 401,
        actorId: clientIp,
        reason: 'WebSocket upgrade rejected: invalid or revoked token'
      })
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    // Block unverified email accounts from activating free-tier live streaming (CARD-17 DoD)
    if (!user.emailVerified) {
      securityLogger.log({
        level: 'warn',
        event: 'auth_email_unverified_blocked',
        route: '/v1/stt',
        status: 403,
        actorId: user.userId,
        reason: 'Unverified email account blocked from live STT WebSocket streaming'
      })
      socket.write('HTTP/1.1 403 Forbidden\r\nX-DualAI-Error: EMAIL_NOT_VERIFIED\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (config.sonioxApiKey) {
        void handleSonioxWebSocketProxy({
          clientSocket: ws,
          req,
          user,
          config,
          quotaStore,
          rateLimiter
        })
      } else {
        void handleSttWebSocketProxy({
          clientSocket: ws,
          req,
          user,
          config,
          quotaStore,
          rateLimiter
        })
      }
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => resolve())
  })

  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : config.port

  return {
    server,
    wss,
    port: actualPort,
    baseUrl: `http://${config.host}:${actualPort}`,
    wsUrl: `ws://${config.host}:${actualPort}`,
    authVerifier,
    quotaStore,
    close: async () => {
      for (const client of wss.clients) {
        client.terminate()
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

// Direct CLI execution entrypoint
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (isDirectRun) {
  createGatewayServer()
    .then((gw) => {
      console.log(`[DUALAI-GATEWAY] Zero-Trust Cloud Gateway active at ${gw.baseUrl}`)
    })
    .catch((err) => {
      console.error('[DUALAI-GATEWAY] Fatal startup error:', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
