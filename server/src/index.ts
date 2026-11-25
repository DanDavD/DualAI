/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Main HTTP & WebSocket Entrypoint
 * Sole architectural owner of Deepgram, Gemini, Supabase Service Role, and Billing secrets.
 * Clients authenticate strictly via Bearer JWT; ZERO provider secrets ever leave this process.
 */

import http, { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { GatewayConfig, loadGatewayConfig } from './config.js'
import { AuthVerifier } from './security/authVerifier.js'
import { GatewayRateLimiter } from './security/rateLimiter.js'
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

function applySecurityHeaders(req: IncomingMessage, res: ServerResponse, config: GatewayConfig): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')

  const origin = req.headers.origin
  if (origin && (config.allowedOrigins.includes(origin) || config.nodeEnv !== 'production')) {
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
  }
): Promise<RunningGatewayServer> {
  const { quotaStore: customQuotaStore, rateLimiter: customRateLimiter, ...configOverrides } =
    overrides || {}

  const config = loadGatewayConfig(configOverrides)
  const authVerifier = new AuthVerifier(config)
  const quotaStore = customQuotaStore || createQuotaStore(config)
  const rateLimiter = customRateLimiter || new GatewayRateLimiter()
  const billingVerifier = new BillingVerifier(config, quotaStore)

  const server = http.createServer(async (req, res) => {
    applySecurityHeaders(req, res, config)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const parsedUrl = new URL(req.url || '/', 'http://localhost')
    const pathname = parsedUrl.pathname
    const clientIp = req.socket.remoteAddress || 'unknown'

    // Global IP rate-limit guard
    const ipLimit = rateLimiter.consume(`ip:${clientIp}`, 1)
    if (!ipLimit.allowed) {
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
        const parsed = JSON.parse(raw.toString('utf-8')) as { email?: string }
        if (!parsed.email) {
          sendJson(res, 400, { code: 'INVALID_EMAIL', message: 'Email is required.' })
          return
        }
        const session = authVerifier.mintDevSessionToken(parsed.email)
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
      sendJson(res, 401, {
        code: 'UNAUTHORIZED',
        message: 'Valid Bearer authentication token required.'
      })
      return
    }

    const userLimit = rateLimiter.consume(`user:${user.userId}`, 1)
    if (!userLimit.allowed) {
      res.setHeader('Retry-After', String(userLimit.retryAfterSec))
      sendJson(res, 429, {
        code: 'USER_RATE_LIMITED',
        message: 'Account request rate limit exceeded.'
      })
      return
    }

    // GET /v1/account/quota
    if (req.method === 'GET' && pathname === '/v1/account/quota') {
      try {
        const quota = await quotaStore.getOrCreateUserQuota(user.userId)
        sendJson(res, 200, {
          user: { userId: user.userId, email: user.email },
          quota,
          plans: Object.values(PLAN_CATALOG)
        })
      } catch {
        sendJson(res, 500, { code: 'QUOTA_FETCH_ERROR', message: 'Unable to retrieve quota.' })
      }
      return
    }

    // POST /v1/translate (Streaming Gemini 2.0 Flash SSE Proxy)
    if (req.method === 'POST' && pathname === '/v1/translate') {
      try {
        const raw = await readRawBody(req, MAX_JSON_BODY_BYTES)
        const payload = JSON.parse(raw.toString('utf-8')) as TranslateProxyPayload
        await handleGeminiTranslateStream({ payload, res, user, config, quotaStore })
      } catch (err) {
        if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
          sendJson(res, 413, { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 64KB limit.' })
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
        sendJson(res, 400, { code: 'INVALID_REQUEST', message: 'Invalid Microsoft Store receipt body.' })
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
      if (config.nodeEnv !== 'production') {
        console.warn('[DUALAI-GATEWAY] WS /v1/stt rejected: 401 Unauthorized (missing or expired token)')
      }
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
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
