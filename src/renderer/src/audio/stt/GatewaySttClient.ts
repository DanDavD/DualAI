/**
 * DUALAI - Zero-Trust Gateway WebSocket STT Client
 * Connects exclusively to the DualAI Cloud Gateway (/v1/stt) using the user's Bearer JWT.
 * Zero upstream Deepgram API keys ever exist in this client or renderer bundle.
 * Receives relayed interim/final transcript frames and authoritative server quota updates.
 */

import { ChannelId } from '../../../../types/audio'
import { DomainId } from '../../../../types/domain'
import {
  SttClientCallbacks,
  SttClientConfig,
  SttConnectionState,
  TranscriptToken,
  TranscriptUtterance
} from '../../../../types/stt'
import { getGatewayWsUrl } from '../../services/gatewayAuthService'
import {
  SonioxRawToken,
  SonioxStreamAssembler,
  UnifiedTurnSnapshot
} from './sonioxStreamAssembler'

interface RelayedWord {
  word: string
  start: number
  end: number
  confidence: number
  punctuated_word?: string
}

interface RelayedGatewayMessage {
  type?: string
  code?: string
  message?: string
  provider?: string
  remainingSeconds?: number
  totalAllocatedSeconds?: number
  duration?: number
  is_final?: boolean
  speech_final?: boolean
  tokens?: SonioxRawToken[]
  finished?: boolean
  channel?: {
    alternatives?: Array<{
      transcript: string
      confidence: number
      words: RelayedWord[]
    }>
  }
}

export interface GatewaySttExtraCallbacks {
  onQuotaUpdate?: (remainingSeconds: number, totalAllocatedSeconds: number) => void
  onQuotaExhausted?: (message: string) => void
  onUnifiedDraft?: (snapshot: UnifiedTurnSnapshot) => void
  onUnifiedCommit?: (snapshot: UnifiedTurnSnapshot) => void
  onUnifiedCommitUpdate?: (snapshot: UnifiedTurnSnapshot) => void
}

export class GatewaySttClient {
  private channelId: ChannelId
  private config: SttClientConfig
  private accessToken: string
  private callbacks: SttClientCallbacks & GatewaySttExtraCallbacks
  private socket: WebSocket | null = null
  private connectionState: SttConnectionState = 'disconnected'
  private reconnectAttempts: number = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private speechStartTimestamp: number = 0
  private currentUtteranceId: string = ''
  private isManuallyClosed: boolean = false
  private activeProvider: 'soniox-unified' | 'deepgram-nova-2' = 'soniox-unified'
  private sonioxAssembler: SonioxStreamAssembler

  constructor(
    channelId: ChannelId,
    config: SttClientConfig,
    accessToken: string,
    callbacks: SttClientCallbacks & GatewaySttExtraCallbacks
  ) {
    this.channelId = channelId
    this.config = config
    this.accessToken = accessToken
    this.callbacks = callbacks
    this.sonioxAssembler = new SonioxStreamAssembler(
      {
        channelId: this.channelId,
        sourceLang: this.config.language,
        targetLang: this.config.targetLanguage || 'es',
        operatingMode: this.config.operatingMode || 'conversation',
        domainId: (this.config.domainId as DomainId) || 'general',
        confidenceThreshold: this.config.confidenceThreshold,
        pauseFallbackMs: 2000
      },
      {
        onUnifiedDraft: (snap) => this.callbacks.onUnifiedDraft?.(snap),
        onUnifiedCommit: (snap) => this.callbacks.onUnifiedCommit?.(snap),
        onUnifiedCommitUpdate: (snap) => this.callbacks.onUnifiedCommitUpdate?.(snap)
      }
    )
  }

  public connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    if (!this.accessToken) {
      this.updateState('error', 'User authentication required')
      this.callbacks.onError(new Error('Sign in required for live DualAI Cloud Gateway STT'))
      return
    }

    this.isManuallyClosed = false
    this.updateState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    try {
      const queryParams = new URLSearchParams({
        language: this.config.language,
        sourceLang: this.config.language,
        targetLang: this.config.targetLanguage || 'es',
        mode: this.config.operatingMode || 'conversation',
        domain: this.config.domainId || 'general',
        endpointing: String(this.config.endpointingMs ?? 250),
        endpointDelayMs: '2000',
        sampleRate: String(this.config.sampleRate || 16000),
        channel: this.channelId
      })
      if (this.config.glossaryTerms && this.config.glossaryTerms.length > 0) {
        queryParams.set('terms', this.config.glossaryTerms.slice(0, 40).join(','))
      }
      const wsUrl = `${getGatewayWsUrl()}/v1/stt?${queryParams.toString()}`

      // Authenticate via WebSocket subprotocol (never place JWT inside URL query string)
      this.socket = new WebSocket(wsUrl, ['dualai-auth', this.accessToken])
      this.socket.binaryType = 'arraybuffer'

      this.socket.onopen = () => {
        this.reconnectAttempts = 0
        this.updateState('connected')
        this.startKeepalive()
      }

      this.socket.onmessage = (event: MessageEvent) => {
        this.handleMessage(event)
      }

      this.socket.onerror = () => {
        // Handled cleanly via onclose state transition
      }

      this.socket.onclose = (event: CloseEvent) => {
        this.stopKeepalive()
        this.socket = null

        if (this.isManuallyClosed || event.code === 1000) {
          this.updateState('disconnected')
          return
        }

        // Authoritative server quota exhaustion or concurrency lock: do NOT auto-reconnect
        if (event.code === 4002) {
          this.updateState('error', 'Interpretation quota exhausted')
          this.callbacks.onQuotaExhausted?.(
            'Your interpretation hours have been used. Upgrade your plan to continue.'
          )
          return
        }
        if (event.code === 4003) {
          this.updateState('error', 'Concurrent session limit reached')
          this.callbacks.onError(
            new Error('Maximum concurrent sessions active on your account.')
          )
          return
        }

        this.handleReconnection(`Gateway socket closed (code: ${event.code})`)
      }
    } catch (err) {
      this.handleReconnection(`Gateway connection error: ${(err as Error).message}`)
    }
  }

  public sendAudio(pcmData: Int16Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    if (this.speechStartTimestamp === 0) {
      this.speechStartTimestamp = performance.now()
      this.currentUtteranceId = `${this.channelId}-${Date.now()}`
    }

    if (pcmData.buffer instanceof ArrayBuffer) {
      const payload =
        pcmData.byteOffset === 0 && pcmData.byteLength === pcmData.buffer.byteLength
          ? pcmData.buffer
          : pcmData.buffer.slice(pcmData.byteOffset, pcmData.byteOffset + pcmData.byteLength)
      this.socket.send(payload)
    }
  }

  public signalSpeechEnd(): void {
    this.speechStartTimestamp = 0
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // Only send legacy Deepgram Finalize when running on legacy fallback;
      // Soniox performs superior semantic endpoint detection natively
      if (this.activeProvider === 'deepgram-nova-2') {
        this.socket.send(JSON.stringify({ type: 'Finalize' }))
      }
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return

    try {
      const data = JSON.parse(event.data) as RelayedGatewayMessage

      if (data.type === 'dualai_quota') {
        if (data.provider === 'soniox-unified') {
          this.activeProvider = 'soniox-unified'
        } else if (data.provider === 'deepgram-nova-2') {
          this.activeProvider = 'deepgram-nova-2'
        }
        if (
          typeof data.remainingSeconds === 'number' &&
          typeof data.totalAllocatedSeconds === 'number'
        ) {
          this.callbacks.onQuotaUpdate?.(data.remainingSeconds, data.totalAllocatedSeconds)
        }
        return
      }

      if (data.type === 'dualai_error') {
        if (data.code === 'QUOTA_EXHAUSTED') {
          this.callbacks.onQuotaExhausted?.(
            data.message || 'Interpretation quota exhausted. Upgrade your plan to continue.'
          )
        } else {
          this.callbacks.onError(new Error(data.message || 'Gateway STT error'))
        }
        return
      }

      // Primary Unified Engine: Soniox Real-Time Token Stream (STT + Diarization + 2-Way Translation)
      if (data.type === 'soniox_tokens' && Array.isArray(data.tokens)) {
        this.activeProvider = 'soniox-unified'
        const now = performance.now()
        const latencyMs =
          this.speechStartTimestamp > 0
            ? Math.max(15, Math.round(now - this.speechStartTimestamp))
            : 45

        this.sonioxAssembler.ingestTokens(data.tokens)

        this.callbacks.onTelemetry({
          channelId: this.channelId,
          latencyMs,
          tokensCount: data.tokens.length,
          connectionState: this.connectionState,
          reconnectCount: this.reconnectAttempts,
          provider: 'soniox-unified'
        })

        if (data.finished) {
          this.sonioxAssembler.flushActiveTurn()
        }
        return
      }

      const alternative = data.channel?.alternatives?.[0]
      if (!alternative || !alternative.transcript) return

      const now = performance.now()
      const latencyMs =
        this.speechStartTimestamp > 0 ? Math.max(15, Math.round(now - this.speechStartTimestamp)) : 48

      const words = alternative.words || []
      const tokens: TranscriptToken[] = words.map((w, idx) => {
        const conf = typeof w.confidence === 'number' ? w.confidence : 0.85
        const roundedConf = Math.round(conf * 100) / 100
        return {
          id: `${this.channelId}-${this.currentUtteranceId || Date.now()}-${idx}`,
          text: w.punctuated_word || w.word || '',
          confidence: roundedConf,
          isLowConfidence: roundedConf < this.config.confidenceThreshold,
          startTimeMs: Math.round((w.start || 0) * 1000),
          endTimeMs: Math.round((w.end || 0) * 1000),
          isPunctuated: Boolean(w.punctuated_word)
        }
      })

      const isFinal = Boolean(data.is_final || data.speech_final)
      const utterance: TranscriptUtterance = {
        id: this.currentUtteranceId || `${this.channelId}-${Date.now()}`,
        channelId: this.channelId,
        speakerLabel: this.channelId === 'channel_a' ? 'Channel A (Mic)' : 'Channel B (System)',
        language: this.config.language,
        text: alternative.transcript.trim(),
        tokens,
        isFinal,
        timestampMs: Date.now(),
        durationMs: data.duration ? Math.round(data.duration * 1000) : 0,
        averageConfidence: Math.round(alternative.confidence * 100) / 100,
        receivedAtMs: Date.now()
      }

      this.callbacks.onTelemetry({
        channelId: this.channelId,
        latencyMs,
        tokensCount: tokens.length,
        connectionState: this.connectionState,
        reconnectCount: this.reconnectAttempts,
        provider: 'deepgram-nova-2'
      })

      if (isFinal) {
        this.callbacks.onFinalTranscript(utterance)
        this.currentUtteranceId = ''
        this.speechStartTimestamp = 0
      } else {
        this.callbacks.onInterimTranscript(utterance)
      }
    } catch {
      // Ignore malformed frames
    }
  }

  private handleReconnection(reason: string): void {
    if (this.isManuallyClosed) return
    if (this.reconnectAttempts >= this.config.reconnectMaxAttempts) {
      this.updateState('error', `Max reconnects exceeded: ${reason}`)
      this.callbacks.onError(new Error(`Gateway WebSocket failed after retries: ${reason}`))
      return
    }

    this.reconnectAttempts++
    const delay =
      Math.min(5000, this.config.reconnectBaseDelayMs * Math.pow(1.5, this.reconnectAttempts - 1)) +
      Math.floor(Math.random() * 200)

    this.updateState(
      'reconnecting',
      `Attempt ${this.reconnectAttempts}/${this.config.reconnectMaxAttempts}`
    )
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  private startKeepalive(): void {
    this.stopKeepalive()
    this.keepaliveTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Lowercase "keepalive" satisfies Soniox spec; Deepgram proxy accepts KeepAlive/keepalive
        const keepaliveType = this.activeProvider === 'deepgram-nova-2' ? 'KeepAlive' : 'keepalive'
        this.socket.send(JSON.stringify({ type: keepaliveType }))
      }
    }, 5000)
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private updateState(state: SttConnectionState, details?: string): void {
    this.connectionState = state
    this.callbacks.onConnectionStateChange(state, details)
  }

  public disconnect(): void {
    this.isManuallyClosed = true
    this.clearReconnectTimer()
    this.stopKeepalive()
    this.sonioxAssembler.reset()

    if (this.socket) {
      this.socket.onopen = null
      this.socket.onmessage = null
      this.socket.onerror = null
      this.socket.onclose = null
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close(1000, 'Session terminated')
      }
      this.socket = null
    }

    this.updateState('disconnected')
  }
}
