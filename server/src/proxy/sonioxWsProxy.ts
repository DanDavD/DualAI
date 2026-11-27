/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Soniox Unified Real-Time WebSocket Proxy
 * Holds SONIOX_API_KEY strictly on the server.
 * Streams 16kHz PCM audio to wss://stt-rt.soniox.com/transcribe-websocket for
 * single-pipeline STT + 15-speaker diarization + automatic language identification
 * + semantic endpoint detection + simultaneous one-way/two-way translation.
 *
 * Cost-Optimization Architecture:
 * - Lazy Upstream Dial (Wake-on-Audio): never opens a billed Soniox stream until
 *   actual speech PCM frames arrive from the client.
 * - Transparent Idle & Mute Hibernation: cleanly closes ONLY the upstream Soniox
 *   WebSocket after extended silence (default 12s) or explicit mute pause (default 1.5s)
 *   while keeping the client socket open, eliminating idle stream billing ($0 during pauses).
 * - Seamless Re-Wake: buffers initial PCM frames during the ~100ms upstream handshake so
 *   zero syllables are dropped when speech resumes.
 * - Enforces server-authoritative quota deduction and hard 4002 cutoff at 0 seconds.
 */

import crypto from 'node:crypto'
import { IncomingMessage } from 'node:http'
import { WebSocket, RawData } from 'ws'
import { GatewayConfig } from '../config.js'
import { AuthenticatedUser } from '../security/authVerifier.js'
import { GatewayRateLimiter } from '../security/rateLimiter.js'
import { QuotaStore } from '../quota/quotaStore.js'
import { SonioxSessionTelemetry } from '../telemetry/sonioxTelemetryRecorder.js'

const WS_CLOSE_QUOTA_EXHAUSTED = 4002
const WS_CLOSE_CONCURRENCY_LIMIT = 4003
const WS_CLOSE_UPSTREAM_UNAVAILABLE = 4011

const DEFAULT_SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
const MAX_PENDING_AUDIO_CHUNKS = 96
const MAX_GLOSSARY_TERMS = 50

const ALLOWED_LANGUAGES = new Set([
  'en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ko', 'ar', 'ru', 'nl', 'pl', 'tr'
])

const DOMAIN_CONTEXT_LABELS: Record<string, string> = {
  medical: 'Clinical medical interpretation (ICD-10, dosages, vitals)',
  legal: 'Legal courtroom interpretation (statutory terms)',
  technical: 'Software and systems engineering interpretation',
  business: 'Corporate finance and business negotiation',
  general: 'Real-time bilingual interpretation'
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
 * Normalizes and case-insensitively deduplicates glossary terms to avoid wasting
 * Soniox input text tokens on repeated or blank entries.
 */
export function normalizeGlossaryTerms(rawTerms?: string[]): string[] {
  if (!rawTerms || rawTerms.length === 0) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of rawTerms) {
    const cleaned = raw.trim()
    if (cleaned.length === 0 || cleaned.length > 80) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
    if (result.length >= MAX_GLOSSARY_TERMS) break
  }
  return result
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
  const cleanTerms = normalizeGlossaryTerms(params.glossaryTerms)

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
    // Per Soniox official guidance for calls & meetings: disable endpoint detection when
    // speaker diarization accuracy is the priority so the model retains full speaker context
    // and avoids premature mid-sentence splits across brief breaths.
    enable_endpoint_detection: false,
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

  // Guard against client disconnect while async quota lookup is in flight (prevents permanent 4003 lockout & timer leak)
  let disconnectedEarly = clientSocket.readyState !== WebSocket.OPEN
  const onEarlyClose = (): void => {
    disconnectedEarly = true
  }
  clientSocket.once('close', onEarlyClose)
  clientSocket.once('error', onEarlyClose)

  const quota = await quotaStore.getOrCreateUserQuota(user.userId)
  clientSocket.removeListener('close', onEarlyClose)
  clientSocket.removeListener('error', onEarlyClose)

  if (disconnectedEarly || clientSocket.readyState !== WebSocket.OPEN) {
    return
  }
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

  // Enforce strict single-stream concurrent session cap (1 Soniox stream per user session;
  // listen-only system audio architecture never requires dual bilateral streams)
  const maxSockets = quota.maxConcurrentSessions
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

  if (!config.sonioxApiKey && config.nodeEnv === 'production') {
    rateLimiter.releaseSession(user.userId, sessionId)
    clientSocket.send(
      JSON.stringify({
        type: 'dualai_error',
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Speech translation provider is not configured on Gateway.'
      })
    )
    clientSocket.close(WS_CLOSE_UPSTREAM_UNAVAILABLE, 'PROVIDER_NOT_CONFIGURED')
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
  const glossaryTerms = normalizeGlossaryTerms(rawTerms ? rawTerms.split(',') : [])

  const sonioxWsUrl = config.sonioxWsUrl || DEFAULT_SONIOX_WS_URL
  const idleHibernateMs = Math.max(500, config.sonioxIdleHibernateMs || 12000)
  const muteHibernateMs = Math.max(200, config.sonioxMuteHibernateMs || 1500)
  const finalizeDrainMs = Math.max(150, config.sonioxFinalizeDrainMs || 900)

  if (config.nodeEnv !== 'production') {
    console.log(
      `[DUALAI-GATEWAY] WS /v1/stt (Soniox Unified, lazy-dial) connected (mode=${operatingMode}, pair=${sourceLang}<->${targetLang}, rate=${sampleRate}Hz, domain=${domainId})`
    )
  }

  let upstreamSocket: WebSocket | null = null
  let upstreamReady = false
  let isDrainingForHibernate = false
  let sentFinalizeSinceLastAudio = false
  let lastFinalizeSentAtMs = 0
  const pendingAudioQueue: Buffer[] = []
  let meterTimer: ReturnType<typeof setInterval> | null = null
  let idleHibernateTimer: ReturnType<typeof setTimeout> | null = null
  let drainCloseTimer: ReturnType<typeof setTimeout> | null = null
  let lastMeterTimestamp = Date.now()
  let receivedAudioInWindow = false
  let loggedFirstAudio = false
  let cleanedUp = false

  const telemetry = new SonioxSessionTelemetry({
    enabled: config.nodeEnv === 'development' && Boolean(config.sonioxApiKey),
    sessionId,
    model: config.sonioxModel,
    mode: operatingMode,
    pair: `${sourceLang}<->${targetLang}`,
    domain: domainId,
    sampleRate
  })

  const clearHibernateTimers = (): void => {
    if (idleHibernateTimer) {
      clearTimeout(idleHibernateTimer)
      idleHibernateTimer = null
    }
    if (drainCloseTimer) {
      clearTimeout(drainCloseTimer)
      drainCloseTimer = null
    }
    isDrainingForHibernate = false
  }

  const detachAndCloseUpstream = (reason: string): void => {
    clearHibernateTimers()
    pendingAudioQueue.length = 0
    if (!upstreamSocket) return
    telemetry.recordUpstreamClosed(reason === 'Idle hibernation' ? 'hibernate' : 'close')
    const sock = upstreamSocket
    upstreamSocket = null
    upstreamReady = false
    sock.removeAllListeners()
    // Swallow teardown errors when closing a mid-handshake CONNECTING upstream socket
    sock.on('error', () => undefined)
    if (sock.readyState === WebSocket.OPEN) {
      sock.close(1000, reason)
    } else if (sock.readyState === WebSocket.CONNECTING) {
      sock.terminate()
    }
  }

  const beginUpstreamHibernate = (): void => {
    idleHibernateTimer = null
    if (cleanedUp || !upstreamSocket) return

    if (upstreamSocket.readyState === WebSocket.OPEN && upstreamReady) {
      const now = Date.now()
      if (!sentFinalizeSinceLastAudio) {
        sentFinalizeSinceLastAudio = true
        lastFinalizeSentAtMs = now
        upstreamSocket.send(JSON.stringify({ type: 'finalize' }))
        telemetry.recordFinalizeSent()
      }
      const elapsedSinceFinalize = now - lastFinalizeSentAtMs
      const remainingDrainMs = Math.max(0, finalizeDrainMs - elapsedSinceFinalize)
      if (remainingDrainMs > 0) {
        isDrainingForHibernate = true
        drainCloseTimer = setTimeout(() => {
          drainCloseTimer = null
          if (!cleanedUp && isDrainingForHibernate) {
            if (config.nodeEnv !== 'production') {
              console.log('[DUALAI-GATEWAY] Upstream Soniox hibernated after silence drain')
            }
            detachAndCloseUpstream('Idle hibernation')
          }
        }, remainingDrainMs)
        return
      }
    }

    if (config.nodeEnv !== 'production') {
      console.log('[DUALAI-GATEWAY] Upstream Soniox hibernated (zero idle billing)')
    }
    detachAndCloseUpstream('Idle hibernation')
  }

  const scheduleIdleHibernate = (delayMs: number): void => {
    clearHibernateTimers()
    if (cleanedUp || !upstreamSocket) return
    idleHibernateTimer = setTimeout(() => {
      beginUpstreamHibernate()
    }, delayMs)
  }

  const ensureUpstreamConnected = (): void => {
    if (cleanedUp || !config.sonioxApiKey || upstreamSocket) return

    const sock = new WebSocket(sonioxWsUrl, {
      headers: {
        Authorization: `Bearer ${config.sonioxApiKey}`
      }
    })
    upstreamSocket = sock
    upstreamReady = false
    isDrainingForHibernate = false

    sock.on('open', () => {
      if (cleanedUp || upstreamSocket !== sock) {
        sock.close(1000, 'Stale upstream closed')
        return
      }

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

      sock.send(JSON.stringify(initPayload))
      upstreamReady = true
      telemetry.recordUpstreamOpened(initPayload)

      if (config.nodeEnv !== 'production') {
        console.log(
          `[DUALAI-GATEWAY] Upstream Soniox Unified awake (model=${config.sonioxModel}, mode=${operatingMode}, pair=${sourceLang}<->${targetLang})`
        )
      }

      // Flush all PCM audio captured while handshake completed
      while (pendingAudioQueue.length > 0 && sock.readyState === WebSocket.OPEN) {
        const chunk = pendingAudioQueue.shift()
        if (chunk) {
          sock.send(chunk, { binary: true })
          telemetry.recordAudioBytesSent(chunk.length)
        }
      }

      scheduleIdleHibernate(idleHibernateMs)
    })

    sock.on('message', (data: RawData) => {
      if (cleanedUp || upstreamSocket !== sock || clientSocket.readyState !== WebSocket.OPEN) return

      try {
        const parsed = JSON.parse(data.toString()) as {
          tokens?: unknown[]
          finished?: boolean
          final_audio_proc_ms?: number
          total_audio_proc_ms?: number
          error_code?: number
          error_message?: string
        }

        telemetry.recordSonioxResponse(parsed)

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

        if (parsed.finished && isDrainingForHibernate) {
          detachAndCloseUpstream('Idle hibernation')
        }
      } catch {
        // Drop malformed upstream frames safely
      }
    })

    sock.on('error', () => {
      if (cleanedUp || upstreamSocket !== sock) return
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

    sock.on('close', (code) => {
      // Only propagate close to client if this was an unexpected drop of the active upstream socket
      if (cleanedUp || upstreamSocket !== sock) return
      upstreamSocket = null
      upstreamReady = false
      clearHibernateTimers()
      cleanup(code === 1000 ? 1000 : WS_CLOSE_UPSTREAM_UNAVAILABLE, 'Upstream closed')
    })
  }

  const cleanup = (closeCode?: number, closeReason?: string): void => {
    if (cleanedUp) return
    cleanedUp = true

    if (meterTimer) {
      clearInterval(meterTimer)
      meterTimer = null
    }
    detachAndCloseUpstream('Proxy session closed')
    telemetry.finish()
    rateLimiter.releaseSession(user.userId, sessionId)

    if (
      closeCode &&
      (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING)
    ) {
      clientSocket.close(closeCode, closeReason || 'Session ended')
    }
  }

  // Send authoritative initial quota & engine handshake to client immediately (before lazy upstream dial)
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
      telemetry.recordQuotaDeducted(elapsedSec)

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

  clientSocket.on('message', (data: RawData, isBinary: boolean) => {
    if (cleanedUp) return

    if (isBinary) {
      receivedAudioInWindow = true
      sentFinalizeSinceLastAudio = false

      if (!loggedFirstAudio && config.nodeEnv !== 'production') {
        loggedFirstAudio = true
        console.log('[DUALAI-GATEWAY] WS /v1/stt (Soniox) receiving live binary PCM frames')
      }

      if (config.sonioxApiKey) {
        if (!upstreamSocket) {
          ensureUpstreamConnected()
        } else {
          // Audio resumed during warm window or drain grace period: cancel hibernation
          scheduleIdleHibernate(idleHibernateMs)
        }

        const buf = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer)
        if (upstreamSocket && upstreamReady && upstreamSocket.readyState === WebSocket.OPEN) {
          upstreamSocket.send(buf, { binary: true })
          telemetry.recordAudioBytesSent(buf.length)
        } else if (upstreamSocket) {
          if (pendingAudioQueue.length >= MAX_PENDING_AUDIO_CHUNKS) {
            pendingAudioQueue.shift()
          }
          pendingAudioQueue.push(buf)
        }
      }
      return
    }

    // Allow strictly whitelisted Soniox control messages (keepalive / finalize / pause)
    try {
      const parsed = JSON.parse(data.toString()) as { type?: string }
      const ctrl = parsed.type?.toLowerCase()

      if (ctrl === 'pause') {
        // Explicit mute/pause: finalize active speech and fast-hibernate upstream to save Soniox billing
        if (upstreamSocket && upstreamReady && upstreamSocket.readyState === WebSocket.OPEN) {
          if (!sentFinalizeSinceLastAudio) {
            sentFinalizeSinceLastAudio = true
            lastFinalizeSentAtMs = Date.now()
            upstreamSocket.send(JSON.stringify({ type: 'finalize' }))
            telemetry.recordFinalizeSent()
          }
          scheduleIdleHibernate(muteHibernateMs)
        } else if (upstreamSocket) {
          detachAndCloseUpstream('Paused before upstream ready')
        }
        return
      }

      if (ctrl === 'finalize') {
        if (upstreamSocket && upstreamReady && upstreamSocket.readyState === WebSocket.OPEN) {
          sentFinalizeSinceLastAudio = true
          lastFinalizeSentAtMs = Date.now()
          upstreamSocket.send(JSON.stringify({ type: 'finalize' }))
          telemetry.recordFinalizeSent()
        }
        return
      }

      if (ctrl === 'keepalive') {
        // Only forward keepalive while upstream is actively warm (not hibernated or draining)
        if (
          upstreamSocket &&
          upstreamReady &&
          !isDrainingForHibernate &&
          upstreamSocket.readyState === WebSocket.OPEN
        ) {
          upstreamSocket.send(JSON.stringify({ type: 'keepalive' }))
          telemetry.recordKeepalive(true)
        } else {
          telemetry.recordKeepalive(false)
        }
      }
    } catch {
      // Ignore malformed control frames
    }
  })

  clientSocket.on('close', () => cleanup())
  clientSocket.on('error', () => cleanup())
}
