/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Soniox Unified Real-Time WebSocket Proxy
 * Holds SONIOX_API_KEY strictly on the server.
 * Streams 16kHz PCM audio to wss://stt-rt.soniox.com/transcribe-websocket for
 * single-pipeline STT + 15-speaker diarization + automatic language identification
 * + semantic endpoint detection + simultaneous one-way/two-way translation.
 * Enforces server-authoritative quota deduction and hard 4002 cutoff at 0 seconds.
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

const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
const MAX_PENDING_AUDIO_CHUNKS = 32
const MAX_GLOSSARY_TERMS = 50

const ALLOWED_LANGUAGES = new Set([
  'en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ko', 'ar', 'ru', 'nl', 'pl', 'tr'
])

const DOMAIN_CONTEXT_LABELS: Record<string, string> = {
  medical: 'Healthcare and clinical medical interpretation (ICD-10 terminology, dosages, vitals)',
  legal: 'Legal courtroom and statutory jurisprudence interpretation (verbatim terms of art)',
  technical: 'Software and systems engineering technical interpretation',
  business: 'Executive corporate finance and business negotiation interpretation',
  general: 'Professional simultaneous real-time bilingual interpretation'
}

export interface SonioxInitPayloadParams {
  model: string
  sampleRate: number
  sourceLang: string
  targetLang: string
  operatingMode: 'translate' | 'conversation'
  domainId: string
  endpointDelayMs: number
  glossaryTerms?: string[]
}

/**
 * Pure builder for the Soniox WebSocket initial configuration message (exported for unit tests).
 * Never includes api_key (authenticated strictly via HTTP Authorization: Bearer header).
 */
export function buildSonioxConfigMessage(params: SonioxInitPayloadParams): Record<string, unknown> {
  const safeSource = ALLOWED_LANGUAGES.has(params.sourceLang) ? params.sourceLang : 'en'
  const safeTarget = ALLOWED_LANGUAGES.has(params.targetLang) ? params.targetLang : 'es'
  const isTwoWay = params.operatingMode === 'conversation' && safeSource !== safeTarget

  const languageHints = isTwoWay
    ? Array.from(new Set([safeSource, safeTarget]))
    : [safeSource]

  const domainValue = DOMAIN_CONTEXT_LABELS[params.domainId] || DOMAIN_CONTEXT_LABELS.general
  const cleanTerms = (params.glossaryTerms || [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 80)
    .slice(0, MAX_GLOSSARY_TERMS)

  const context: Record<string, unknown> = {
    general: [{ key: 'domain', value: domainValue }]
  }
  if (cleanTerms.length > 0) {
    context.terms = cleanTerms
  }

  const translation = isTwoWay
    ? {
        type: 'two_way',
        language_a: safeSource,
        language_b: safeTarget
      }
    : {
        type: 'one_way',
        target_language: safeTarget
      }

  return {
    model: params.model || 'stt-rt-v6',
    audio_format: 'pcm_s16le',
    sample_rate: params.sampleRate,
    num_channels: 1,
    language_hints: languageHints,
    language_hints_strict: true,
    enable_speaker_diarization: true,
    enable_language_identification: true,
    enable_endpoint_detection: true,
    max_endpoint_delay_ms: Math.max(500, Math.min(3000, params.endpointDelayMs)),
    context,
    translation
  }
}

export async function handleSonioxWebSocketProxy(params: {
  clientSocket: WebSocket
  req: IncomingMessage
  user: AuthenticatedUser
  config: GatewayConfig
  quotaStore: QuotaStore
  rateLimiter: GatewayRateLimiter
}): Promise<void> {
  const { clientSocket, req, user, config, quotaStore, rateLimiter } = params
  const sessionId = `soniox-${crypto.randomUUID()}`

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

  // Enforce concurrent session cap (1 for Free/Pro/Unlimited, up to 2 channels in bilateral mode)
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
  const requestedSource = (
    parsedUrl.searchParams.get('sourceLang') ||
    parsedUrl.searchParams.get('language') ||
    'en'
  ).toLowerCase()
  const requestedTarget = (parsedUrl.searchParams.get('targetLang') || 'es').toLowerCase()
  const sourceLang = ALLOWED_LANGUAGES.has(requestedSource) ? requestedSource : 'en'
  const targetLang = ALLOWED_LANGUAGES.has(requestedTarget) ? requestedTarget : 'es'
  const rawMode = (parsedUrl.searchParams.get('mode') || 'conversation').toLowerCase()
  const operatingMode: 'translate' | 'conversation' =
    rawMode === 'translate' ? 'translate' : 'conversation'
  const domainId = (parsedUrl.searchParams.get('domain') || 'general').toLowerCase()
  const rawEndpointDelay = Number(parsedUrl.searchParams.get('endpointDelayMs') || '2000')
  const endpointDelayMs = Math.max(
    500,
    Math.min(3000, Number.isFinite(rawEndpointDelay) ? rawEndpointDelay : 2000)
  )
  const rawSampleRate = Number(parsedUrl.searchParams.get('sampleRate') || '16000')
  const sampleRate = [16000, 24000, 44100, 48000].includes(rawSampleRate) ? rawSampleRate : 16000
  const channelMode = parsedUrl.searchParams.get('route') || 'system'
  const rawTerms = parsedUrl.searchParams.get('terms') || ''
  const glossaryTerms = rawTerms
    ? rawTerms
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, MAX_GLOSSARY_TERMS)
    : []

  if (config.nodeEnv !== 'production') {
    console.log(
      `[DUALAI-GATEWAY] WS /v1/stt (Soniox Unified) connected (mode=${operatingMode}, pair=${sourceLang}<->${targetLang}, rate=${sampleRate}Hz, domain=${domainId})`
    )
  }

  let upstreamSocket: WebSocket | null = null
  let upstreamReady = false
  const pendingAudioQueue: Buffer[] = []
  let meterTimer: ReturnType<typeof setInterval> | null = null
  let lastMeterTimestamp = Date.now()
  let receivedAudioInWindow = false
  let loggedFirstAudio = false
  let cleanedUp = false

  const cleanup = (closeCode?: number, closeReason?: string): void => {
    if (cleanedUp) return
    cleanedUp = true

    if (meterTimer) {
      clearInterval(meterTimer)
      meterTimer = null
    }
    pendingAudioQueue.length = 0
    rateLimiter.releaseSession(user.userId, sessionId)

    if (upstreamSocket) {
      const sock = upstreamSocket
      upstreamSocket = null
      sock.removeAllListeners()
      // Swallow teardown errors when closing a mid-handshake CONNECTING upstream socket
      sock.on('error', () => undefined)
      if (sock.readyState === WebSocket.OPEN) {
        sock.close(1000, 'Proxy session closed')
      } else if (sock.readyState === WebSocket.CONNECTING) {
        sock.terminate()
      }
    }

    if (
      closeCode &&
      (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING)
    ) {
      clientSocket.close(closeCode, closeReason || 'Session ended')
    }
  }

  // Send authoritative initial quota & engine handshake to client
  if (clientSocket.readyState === WebSocket.OPEN) {
    clientSocket.send(
      JSON.stringify({
        type: 'dualai_quota',
        remainingSeconds: quota.remainingSeconds,
        totalAllocatedSeconds: quota.totalAllocatedSeconds,
        planId: quota.planId,
        provider: config.sonioxApiKey ? 'soniox-unified' : 'gateway-dev-mock'
      })
    )
  }

  // Authoritative server-side quota metering loop (bills active speech windows only)
  const intervalMs = Math.max(1000, config.quotaMeterIntervalMs)
  meterTimer = setInterval(async () => {
    if (cleanedUp) return
    const now = Date.now()
    const elapsedSec = Math.max(1, Math.round((now - lastMeterTimestamp) / 1000))
    lastMeterTimestamp = now

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
            planId: quota.planId,
            provider: config.sonioxApiKey ? 'soniox-unified' : 'gateway-dev-mock'
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

  // Connect private upstream socket to Soniox Real-Time Unified API
  if (config.sonioxApiKey) {
    upstreamSocket = new WebSocket(SONIOX_WS_URL, {
      headers: {
        Authorization: `Bearer ${config.sonioxApiKey}`
      }
    })

    upstreamSocket.on('open', () => {
      if (cleanedUp || !upstreamSocket) return

      const initPayload = buildSonioxConfigMessage({
        model: config.sonioxModel,
        sampleRate,
        sourceLang,
        targetLang,
        operatingMode,
        domainId,
        endpointDelayMs,
        glossaryTerms
      })

      upstreamSocket.send(JSON.stringify(initPayload))
      upstreamReady = true

      if (config.nodeEnv !== 'production') {
        console.log(
          `[DUALAI-GATEWAY] Upstream Soniox Unified open (model=${config.sonioxModel}, mode=${operatingMode}, pair=${sourceLang}<->${targetLang})`
        )
      }

      // Flush any initial PCM audio captured while handshake completed
      while (pendingAudioQueue.length > 0 && upstreamSocket.readyState === WebSocket.OPEN) {
        const chunk = pendingAudioQueue.shift()
        if (chunk) {
          upstreamSocket.send(chunk, { binary: true })
        }
      }
    })

    upstreamSocket.on('message', (data: RawData) => {
      if (cleanedUp || clientSocket.readyState !== WebSocket.OPEN) return

      try {
        const parsed = JSON.parse(data.toString()) as {
          tokens?: unknown[]
          finished?: boolean
          error_code?: number
          error_message?: string
        }

        if (parsed.error_code || parsed.error_message) {
          if (config.nodeEnv !== 'production') {
            console.warn(
              `[DUALAI-GATEWAY] Upstream Soniox error (code=${parsed.error_code ?? 'unknown'})`
            )
          }
          clientSocket.send(
            JSON.stringify({
              type: 'dualai_error',
              code: 'UPSTREAM_SONIOX_ERROR',
              message:
                parsed.error_code === 401 || parsed.error_code === 403
                  ? 'Soniox API key rejected on Gateway. Verify SONIOX_API_KEY in server/.env.'
                  : parsed.error_code === 402
                    ? 'Soniox account credits exhausted on Gateway.'
                    : 'Unified speech translation stream interrupted.'
            })
          )
          return
        }

        if (Array.isArray(parsed.tokens) || parsed.finished) {
          clientSocket.send(
            JSON.stringify({
              type: 'soniox_tokens',
              tokens: parsed.tokens || [],
              finished: Boolean(parsed.finished)
            })
          )
        }
      } catch {
        // Drop malformed upstream frames safely
      }
    })

    upstreamSocket.on('error', () => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(
          JSON.stringify({
            type: 'dualai_error',
            code: 'UPSTREAM_SONIOX_ERROR',
            message: 'Upstream Soniox speech translation link interrupted.'
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
        message: 'Speech translation provider is not configured on Gateway.'
      })
    )
    cleanup(WS_CLOSE_UPSTREAM_UNAVAILABLE, 'PROVIDER_NOT_CONFIGURED')
    return
  }

  clientSocket.on('message', (data: RawData, isBinary: boolean) => {
    if (cleanedUp) return

    if (isBinary) {
      receivedAudioInWindow = true
      if (!loggedFirstAudio && config.nodeEnv !== 'production') {
        loggedFirstAudio = true
        console.log('[DUALAI-GATEWAY] WS /v1/stt (Soniox) receiving live binary PCM frames')
      }

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      if (upstreamSocket && upstreamReady && upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(buf, { binary: true })
      } else if (upstreamSocket && pendingAudioQueue.length < MAX_PENDING_AUDIO_CHUNKS) {
        pendingAudioQueue.push(buf)
      }
      return
    }

    // Allow strictly whitelisted Soniox control messages (keepalive / finalize)
    try {
      const parsed = JSON.parse(data.toString()) as { type?: string }
      const ctrl = parsed.type?.toLowerCase()
      if (
        (ctrl === 'keepalive' || ctrl === 'finalize') &&
        upstreamSocket &&
        upstreamReady &&
        upstreamSocket.readyState === WebSocket.OPEN
      ) {
        upstreamSocket.send(JSON.stringify({ type: ctrl }))
      }
    } catch {
      // Ignore malformed control frames
    }
  })

  clientSocket.on('close', () => cleanup())
  clientSocket.on('error', () => cleanup())
}
