/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Deepgram Real-Time WebSocket Proxy (Nova-3 / Nova-2)
 * Holds DEEPGRAM_API_KEY strictly on the server.
 * Streams 16kHz linear16 PCM audio upstream to Deepgram with:
 * - Real-time speaker diarization (diarize=true) for instant interruption splits
 * - Bilingual code-switching (language=multi on Nova-3 in Conversation mode)
 * - Custom glossary boosting (keyterm on Nova-3, keywords on Nova-2)
 * - Lazy Upstream Dial (Wake-on-Audio): $0 billed before actual speech PCM arrives
 * - Transparent Idle (12s) & Mute/Pause (1.5s) Hibernation with KeepAlive absorption
 * - Seamless Re-Wake with buffered PCM flush (zero clipped opening syllables)
 * - Authoritative server quota deduction and hard 4002 cutoff at 0 seconds.
 */

import crypto from 'node:crypto'
import { IncomingMessage } from 'node:http'
import { WebSocket, RawData } from 'ws'
import { GatewayConfig } from '../config.js'
import { AuthenticatedUser } from '../security/authVerifier.js'
import { GatewayRateLimiter } from '../security/rateLimiter.js'
import { QuotaStore } from '../quota/quotaStore.js'
import { normalizeGlossaryTerms } from './sonioxWsProxy.js'

const WS_CLOSE_QUOTA_EXHAUSTED = 4002
const WS_CLOSE_CONCURRENCY_LIMIT = 4003
const WS_CLOSE_UPSTREAM_UNAVAILABLE = 4011

const DEFAULT_DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen'
const MAX_PENDING_AUDIO_CHUNKS = 96
const MAX_DEEPGRAM_GLOSSARY_TERMS = 40

const ALLOWED_LANGUAGES = new Set([
  'en', 'es', 'pt', 'fr', 'de', 'it', 'zh', 'ja', 'ko', 'ar', 'ru', 'nl', 'pl', 'tr'
])

export interface DeepgramListenUrlParams {
  baseWsUrl?: string
  model: string
  domainId?: string
  sampleRate: number
  sourceLang: string
  targetLang: string
  operatingMode: 'translate' | 'conversation'
  endpointing: number
  glossaryTerms?: string[]
}

/**
 * Resolves the best Deepgram streaming model for the active Conversation Topic at the same
 * Nova-3 pricing tier: uses `nova-3-medical` for Medical / Clinical sessions and `nova-3`
 * for General, Legal, Technical, and Business sessions.
 */
export function resolveDeepgramModelForDomain(baseModel: string, domainId?: string): string {
  const cleanBase = baseModel?.trim() || 'nova-3'
  const normalizedDomain = (domainId || 'general').trim().toLowerCase()
  if (cleanBase.toLowerCase() === 'nova-3' && normalizedDomain === 'medical') {
    return 'nova-3-medical'
  }
  return cleanBase
}

/**
 * Pure builder for the Deepgram streaming listen URL (exported for unit tests).
 * Never embeds API keys in the URL (authenticated strictly via HTTP Authorization header).
 */
export function buildDeepgramListenUrl(params: DeepgramListenUrlParams): string {
  const safeBase = params.baseWsUrl?.trim() || DEFAULT_DEEPGRAM_WS_URL
  const safeModel = resolveDeepgramModelForDomain(params.model, params.domainId)
  const isNova3 = safeModel.toLowerCase().startsWith('nova-3')
  const safeSource = ALLOWED_LANGUAGES.has(params.sourceLang) ? params.sourceLang : 'en'
  const safeTarget = ALLOWED_LANGUAGES.has(params.targetLang) ? params.targetLang : 'es'
  // Only Nova-3 supports live multilingual code-switching (language=multi); Nova-2 rejects it with HTTP 400
  const isMultilingualConversation =
    isNova3 && params.operatingMode === 'conversation' && safeSource !== safeTarget
  // 300ms endpointing on Nova-3 language=multi balances bilingual context with <=1.0s post-speech translation
  const effectiveEndpointing = isMultilingualConversation
    ? Math.max(300, params.endpointing)
    : params.endpointing

  const queryParams = new URLSearchParams({
    model: safeModel,
    encoding: 'linear16',
    sample_rate: String(params.sampleRate),
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    diarize: 'true',
    endpointing: String(effectiveEndpointing),
    language: isMultilingualConversation ? 'multi' : safeSource
  })

  const cleanTerms = normalizeGlossaryTerms(params.glossaryTerms).slice(
    0,
    MAX_DEEPGRAM_GLOSSARY_TERMS
  )
  for (const term of cleanTerms) {
    queryParams.append(isNova3 ? 'keyterm' : 'keywords', term)
  }

  const separator = safeBase.includes('?') ? '&' : '?'
  return `${safeBase}${separator}${queryParams.toString()}`
}

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

  // Guard against client disconnect or transient quota store errors while async quota lookup is in flight
  let disconnectedEarly = clientSocket.readyState !== WebSocket.OPEN
  const onEarlyClose = (): void => {
    disconnectedEarly = true
  }
  clientSocket.once('close', onEarlyClose)
  clientSocket.once('error', onEarlyClose)

  let quota: Awaited<ReturnType<QuotaStore['getOrCreateUserQuota']>>
  try {
    quota = await quotaStore.getOrCreateUserQuota(user.userId)
  } catch {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(
        JSON.stringify({
          type: 'dualai_error',
          code: 'QUOTA_SYNC_ERROR',
          message: 'Unable to verify interpretation quota right now. Please reconnect.'
        })
      )
      clientSocket.close(WS_CLOSE_UPSTREAM_UNAVAILABLE, 'QUOTA_SYNC_ERROR')
    }
    return
  } finally {
    clientSocket.removeListener('close', onEarlyClose)
    clientSocket.removeListener('error', onEarlyClose)
  }

  if (disconnectedEarly || clientSocket.readyState !== WebSocket.OPEN) {
    return
  }

  if (quota.subscriptionStatus === 'canceled') {
    clientSocket.send(
      JSON.stringify({
        type: 'dualai_error',
        code: 'SUBSCRIPTION_CANCELED',
        message: 'Your subscription has ended. Upgrade your plan to continue.'
      })
    )
    clientSocket.close(WS_CLOSE_QUOTA_EXHAUSTED, 'SUBSCRIPTION_CANCELED')
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

  // Enforce strict single-stream concurrent session cap (listen-only system audio architecture)
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

  if (!config.deepgramApiKey && config.nodeEnv === 'production') {
    rateLimiter.releaseSession(user.userId, sessionId)
    clientSocket.send(
      JSON.stringify({
        type: 'dualai_error',
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Speech recognition provider is not configured on Gateway.'
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
  const rawEndpointing = Number(parsedUrl.searchParams.get('endpointing') || '300')
  const endpointing = Math.max(
    150,
    Math.min(1200, Number.isFinite(rawEndpointing) ? rawEndpointing : 300)
  )
  const rawSampleRate = Number(parsedUrl.searchParams.get('sampleRate') || '16000')
  const sampleRate = [16000, 24000, 44100, 48000].includes(rawSampleRate) ? rawSampleRate : 16000
  const channelMode = parsedUrl.searchParams.get('route') || 'system'
  const domainId = (parsedUrl.searchParams.get('domain') || 'general').toLowerCase()
  const rawTerms = parsedUrl.searchParams.get('terms') || ''
  const glossaryTerms = normalizeGlossaryTerms(rawTerms ? rawTerms.split(',') : [])

  const deepgramModel = resolveDeepgramModelForDomain(config.deepgramModel || 'nova-3', domainId)
  const deepgramWsUrl = config.deepgramWsUrl || DEFAULT_DEEPGRAM_WS_URL
  const idleHibernateMs = Math.max(500, config.deepgramIdleHibernateMs || 8000)
  const muteHibernateMs = Math.max(200, config.deepgramMuteHibernateMs || 1500)
  const finalizeDrainMs = Math.max(150, config.deepgramFinalizeDrainMs || 900)
  const providerLabel = config.deepgramApiKey
    ? deepgramModel.toLowerCase().startsWith('nova-3')
      ? 'deepgram-nova-3'
      : 'deepgram-nova-2'
    : 'gateway-dev-mock'

  if (config.nodeEnv !== 'production') {
    console.log(
      `[DUALAI-GATEWAY] WS /v1/stt (Deepgram ${deepgramModel}, lazy-dial) connected (mode=${operatingMode}, pair=${sourceLang}<->${targetLang}, rate=${sampleRate}Hz, endpointing=${endpointing}ms)`
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
    const sock = upstreamSocket
    upstreamSocket = null
    upstreamReady = false
    sock.removeAllListeners()
    // Swallow teardown errors when closing a mid-handshake CONNECTING upstream socket
    sock.on('error', () => undefined)
    if (sock.readyState === WebSocket.OPEN) {
      try {
        sock.send(JSON.stringify({ type: 'CloseStream' }))
      } catch {
        // Ignore close frame write errors
      }
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
        upstreamSocket.send(JSON.stringify({ type: 'Finalize' }))
      }
      const elapsedSinceFinalize = now - lastFinalizeSentAtMs
      const remainingDrainMs = Math.max(0, finalizeDrainMs - elapsedSinceFinalize)
      if (remainingDrainMs > 0) {
        isDrainingForHibernate = true
        drainCloseTimer = setTimeout(() => {
          drainCloseTimer = null
          if (!cleanedUp && isDrainingForHibernate) {
            if (config.nodeEnv !== 'production') {
              console.log('[DUALAI-GATEWAY] Upstream Deepgram hibernated after silence drain')
            }
            detachAndCloseUpstream('Idle hibernation')
          }
        }, remainingDrainMs)
        return
      }
    }

    if (config.nodeEnv !== 'production') {
      console.log('[DUALAI-GATEWAY] Upstream Deepgram hibernated (zero idle billing)')
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
    if (cleanedUp || !config.deepgramApiKey || upstreamSocket) return

    const deepgramUrl = buildDeepgramListenUrl({
      baseWsUrl: deepgramWsUrl,
      model: deepgramModel,
      domainId,
      sampleRate,
      sourceLang,
      targetLang,
      operatingMode,
      endpointing,
      glossaryTerms
    })

    const sock = new WebSocket(deepgramUrl, {
      headers: {
        Authorization: `Token ${config.deepgramApiKey}`
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

      upstreamReady = true
      if (config.nodeEnv !== 'production') {
        console.log(
          `[DUALAI-GATEWAY] Upstream Deepgram ${deepgramModel} awake (mode=${operatingMode}, pair=${sourceLang}<->${targetLang}, rate=${sampleRate}Hz)`
        )
      }

      // Flush all PCM audio captured while handshake completed (zero clipped opening syllables)
      while (pendingAudioQueue.length > 0 && sock.readyState === WebSocket.OPEN) {
        const chunk = pendingAudioQueue.shift()
        if (chunk) {
          sock.send(chunk, { binary: true })
        }
      }

      scheduleIdleHibernate(idleHibernateMs)
    })

    sock.on('message', (data: RawData, isBinary: boolean) => {
      if (cleanedUp || upstreamSocket !== sock || clientSocket.readyState !== WebSocket.OPEN) return

      if (isBinary) {
        clientSocket.send(data)
        return
      }

      const textPayload = data.toString()
      clientSocket.send(textPayload)

      // If draining for hibernation and Deepgram sent a finalized flush frame, close upstream promptly
      if (isDrainingForHibernate) {
        try {
          const parsed = JSON.parse(textPayload) as { from_finalize?: boolean }
          if (parsed.from_finalize) {
            detachAndCloseUpstream('Idle hibernation')
          }
        } catch {
          // Ignore non-JSON frames
        }
      }
    })

    sock.on('error', () => {
      if (cleanedUp || upstreamSocket !== sock) return
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
    rateLimiter.releaseSession(user.userId, sessionId)

    if (
      closeCode &&
      (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING)
    ) {
      clientSocket.close(closeCode, closeReason || 'Session ended')
    }
  }

  // Send authoritative initial quota & engine handshake immediately (before lazy upstream dial)
  if (clientSocket.readyState === WebSocket.OPEN) {
    clientSocket.send(
      JSON.stringify({
        type: 'dualai_quota',
        remainingSeconds: quota.remainingSeconds,
        totalAllocatedSeconds: quota.totalAllocatedSeconds,
        planId: quota.planId,
        provider: providerLabel
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
            provider: providerLabel
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
        console.log('[DUALAI-GATEWAY] WS /v1/stt (Deepgram) receiving live binary PCM frames')
      }

      if (config.deepgramApiKey) {
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
        } else if (upstreamSocket) {
          if (pendingAudioQueue.length >= MAX_PENDING_AUDIO_CHUNKS) {
            pendingAudioQueue.shift()
          }
          pendingAudioQueue.push(buf)
        }
      }
      return
    }

    // Allow strictly whitelisted Deepgram control messages (KeepAlive / Finalize / pause)
    try {
      const parsed = JSON.parse(data.toString()) as { type?: string }
      const ctrl = parsed.type?.toLowerCase()

      if (ctrl === 'pause') {
        // Explicit mute/pause: finalize pending words and fast-hibernate upstream ($0 idle billing)
        if (upstreamSocket && upstreamReady && upstreamSocket.readyState === WebSocket.OPEN) {
          if (!sentFinalizeSinceLastAudio) {
            sentFinalizeSinceLastAudio = true
            lastFinalizeSentAtMs = Date.now()
            upstreamSocket.send(JSON.stringify({ type: 'Finalize' }))
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
          upstreamSocket.send(JSON.stringify({ type: 'Finalize' }))
        }
        return
      }

      if (ctrl === 'keepalive') {
        // Only forward KeepAlive while upstream is actively warm (absorbed silently when hibernated)
        if (
          upstreamSocket &&
          upstreamReady &&
          !isDrainingForHibernate &&
          upstreamSocket.readyState === WebSocket.OPEN
        ) {
          upstreamSocket.send(JSON.stringify({ type: 'KeepAlive' }))
        }
      }
    } catch {
      // Drop malformed non-JSON text frames silently
    }
  })

  clientSocket.on('close', () => cleanup())
  clientSocket.on('error', () => cleanup())
}
