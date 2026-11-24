/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Deepgram Nova-2 WebSocket Relay Proxy
 * Holds DEEPGRAM_API_KEY strictly on the server.
 * Relays binary 16kHz PCM audio upstream and transcript JSON downstream,
 * enforces server-authoritative quota deduction every metering interval,
 * and force-closes with code 4002 (QUOTA_EXHAUSTED) the instant remaining_seconds hits 0.
 */

import crypto from 'node:crypto'
import { IncomingMessage } from 'node:http'
import { WebSocket, RawData } from 'ws'
import { GatewayConfig } from '../config.js'
import { AuthenticatedUser } from '../security/authVerifier.js'
import { GatewayRateLimiter } from '../security/rateLimiter.js'
import { QuotaStore } from '../quota/quotaStore.js'

const WS_CLOSE_QUOTA_EXHAUSTED = 4002
const WS_CLOSE_CONCURRENCY_LIMIT = 4003
const WS_CLOSE_UPSTREAM_UNAVAILABLE = 4011

const ALLOWED_LANGUAGES = new Set([
  'en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ko', 'ar', 'ru', 'nl', 'pl', 'tr'
])

export async function handleSttWebSocketProxy(params: {
  clientSocket: WebSocket
  req: IncomingMessage
  user: AuthenticatedUser
  config: GatewayConfig
  quotaStore: QuotaStore
  rateLimiter: GatewayRateLimiter
}): Promise<void> {
  const { clientSocket, req, user, config, quotaStore, rateLimiter } = params
  const sessionId = `stt-${crypto.randomUUID()}`

  const quota = await quotaStore.getOrCreateUserQuota(user.userId)
  if (quota.remainingSeconds <= 0) {
    clientSocket.send(
      JSON.stringify({
        type: 'dualai_error',
        code: 'QUOTA_EXHAUSTED',
        message: 'Your interpretation quota has been exhausted. Upgrade your plan to continue.'
      })
    )
    clientSocket.close(WS_CLOSE_QUOTA_EXHAUSTED, 'QUOTA_EXHAUSTED')
    return
  }

  // Enforce concurrent session cap (1 for Free/Starter, 2 for Pro, 3 for Enterprise)
  // Note: Dual-channel bilateral mode opens up to 2 channels per desktop session
  const maxSockets = quota.maxConcurrentSessions * 2
  if (!rateLimiter.acquireSession(user.userId, sessionId, maxSockets)) {
    clientSocket.send(
      JSON.stringify({
        type: 'dualai_error',
        code: 'CONCURRENCY_LIMIT',
        message: 'Maximum concurrent active interpretation sessions reached for your plan.'
      })
    )
    clientSocket.close(WS_CLOSE_CONCURRENCY_LIMIT, 'CONCURRENCY_LIMIT')
    return
  }

  const parsedUrl = new URL(req.url || '/v1/stt', 'http://localhost')
  const requestedLang = (parsedUrl.searchParams.get('language') || 'en').toLowerCase()
  const language = ALLOWED_LANGUAGES.has(requestedLang) ? requestedLang : 'en'
  const rawEndpointing = Number(parsedUrl.searchParams.get('endpointing') || '250')
  const endpointing = Math.max(150, Math.min(1200, Number.isFinite(rawEndpointing) ? rawEndpointing : 250))
  const channelMode = parsedUrl.searchParams.get('route') || 'system'

  let upstreamSocket: WebSocket | null = null
  let meterTimer: ReturnType<typeof setInterval> | null = null
  let lastMeterTimestamp = Date.now()
  let receivedAudioInWindow = false
  let cleanedUp = false

  const cleanup = (closeCode?: number, closeReason?: string): void => {
    if (cleanedUp) return
    cleanedUp = true

    if (meterTimer) {
      clearInterval(meterTimer)
      meterTimer = null
    }
    rateLimiter.releaseSession(user.userId, sessionId)

    if (upstreamSocket) {
      upstreamSocket.removeAllListeners()
      if (
        upstreamSocket.readyState === WebSocket.OPEN ||
        upstreamSocket.readyState === WebSocket.CONNECTING
      ) {
        upstreamSocket.close(1000, 'Proxy session closed')
      }
      upstreamSocket = null
    }

    if (
      closeCode &&
      (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING)
    ) {
      clientSocket.close(closeCode, closeReason || 'Session ended')
    }
  }

  // Send authoritative initial quota snapshot to client
  if (clientSocket.readyState === WebSocket.OPEN) {
    clientSocket.send(
      JSON.stringify({
        type: 'dualai_quota',
        remainingSeconds: quota.remainingSeconds,
        totalAllocatedSeconds: quota.totalAllocatedSeconds,
        planId: quota.planId,
        provider: config.deepgramApiKey ? 'deepgram-nova-2' : 'gateway-dev-mock'
      })
    )
  }

  // Authoritative server-side quota metering loop
  const intervalMs = Math.max(1000, config.quotaMeterIntervalMs)
  meterTimer = setInterval(async () => {
    if (cleanedUp) return
    const now = Date.now()
    const elapsedSec = Math.max(1, Math.round((now - lastMeterTimestamp) / 1000))
    lastMeterTimestamp = now

    // Bill active streaming intervals (prevents idle socket drain while metering real speech usage)
    if (!receivedAudioInWindow) return
    receivedAudioInWindow = false

    try {
      const updated = await quotaStore.deductSeconds(
        user.userId,
        sessionId,
        elapsedSec,
        ['system', 'mic', 'bilateral', 'app'].includes(channelMode) ? channelMode : 'system'
      )

      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(
          JSON.stringify({
            type: 'dualai_quota',
            remainingSeconds: updated.remainingSeconds,
            totalAllocatedSeconds: updated.totalAllocatedSeconds,
            planId: quota.planId
          })
        )
      }

      if (updated.exhausted) {
        if (clientSocket.readyState === WebSocket.OPEN) {
          clientSocket.send(
            JSON.stringify({
              type: 'dualai_error',
              code: 'QUOTA_EXHAUSTED',
              message: 'Interpretation quota exhausted. Upgrade your plan to continue.'
            })
          )
        }
        cleanup(WS_CLOSE_QUOTA_EXHAUSTED, 'QUOTA_EXHAUSTED')
      }
    } catch {
      cleanup(WS_CLOSE_UPSTREAM_UNAVAILABLE, 'QUOTA_SYNC_ERROR')
    }
  }, intervalMs)

  // Connect private upstream socket to Deepgram Nova-2 if server key is configured
  if (config.deepgramApiKey) {
    const queryParams = new URLSearchParams({
      model: 'nova-2',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      endpointing: String(endpointing),
      language
    })

    const deepgramUrl = `wss://api.deepgram.com/v1/listen?${queryParams.toString()}`
    upstreamSocket = new WebSocket(deepgramUrl, {
      headers: {
        Authorization: `Token ${config.deepgramApiKey}`
      }
    })

    upstreamSocket.on('message', (data: RawData, isBinary: boolean) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(isBinary ? data : data.toString())
      }
    })

    upstreamSocket.on('error', () => {
      // Never forward upstream error details that could leak provider headers or URLs
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(
          JSON.stringify({
            type: 'dualai_error',
            code: 'UPSTREAM_STT_ERROR',
            message: 'Upstream speech recognition link interrupted.'
          })
        )
      }
    })

    upstreamSocket.on('close', (code) => {
      if (!cleanedUp) {
        cleanup(code === 1000 ? 1000 : WS_CLOSE_UPSTREAM_UNAVAILABLE, 'Upstream closed')
      }
    })
  } else if (config.nodeEnv === 'production') {
    clientSocket.send(
      JSON.stringify({
        type: 'dualai_error',
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Speech recognition provider is not configured on Gateway.'
      })
    )
    cleanup(WS_CLOSE_UPSTREAM_UNAVAILABLE, 'PROVIDER_NOT_CONFIGURED')
    return
  }

  clientSocket.on('message', (data: RawData, isBinary: boolean) => {
    if (cleanedUp) return

    if (isBinary) {
      receivedAudioInWindow = true
      if (upstreamSocket && upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(data, { binary: true })
      }
      return
    }

    // Allow strictly whitelisted control messages (KeepAlive / Finalize)
    try {
      const parsed = JSON.parse(data.toString()) as { type?: string }
      if (parsed.type === 'KeepAlive' || parsed.type === 'Finalize') {
        if (upstreamSocket && upstreamSocket.readyState === WebSocket.OPEN) {
          upstreamSocket.send(JSON.stringify({ type: parsed.type }))
        }
      }
    } catch {
      // Drop malformed non-JSON text frames silently
    }
  })

  clientSocket.on('close', () => cleanup())
  clientSocket.on('error', () => cleanup())
}
