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

export interface RelayedWord {
  word: string
  start: number
  end: number
  confidence: number
  punctuated_word?: string
  speaker?: number
  speaker_confidence?: number
  language?: string
}

export interface DeepgramSpeakerSegment {
  speakerId?: string
  speakerLabel: string
  text: string
  tokens: TranscriptToken[]
  averageConfidence: number
  language?: string
}

/**
 * Splits a single Deepgram Results word array into ordered contiguous speaker runs
 * so mid-frame speaker interruptions (e.g. Speaker 0 -> Speaker 1) emit separate
 * utterances and trigger immediate 0ms paragraph separation in ParagraphTurnAccumulator.
 */
export function splitDeepgramWordsBySpeaker(params: {
  words: RelayedWord[]
  fallbackTranscript: string
  fallbackConfidence: number
  alternativeLanguages?: string[]
  channelId: ChannelId
  utteranceIdPrefix: string
  confidenceThreshold: number
}): DeepgramSpeakerSegment[] {
  const {
    words,
    fallbackTranscript,
    fallbackConfidence,
    alternativeLanguages,
    channelId,
    utteranceIdPrefix,
    confidenceThreshold
  } = params

  const defaultLabel = channelId === 'channel_a' ? 'Channel A (Mic)' : 'Speaker 1'
  const fallbackAltLang =
    Array.isArray(alternativeLanguages) &&
    typeof alternativeLanguages[0] === 'string' &&
    alternativeLanguages[0].trim()
      ? alternativeLanguages[0].trim().toLowerCase().split(/[-_]/)[0]
      : undefined

  if (!Array.isArray(words) || words.length === 0) {
    const clean = fallbackTranscript.trim()
    if (!clean) return []
    return [
      {
        speakerId: channelId === 'channel_b' ? '1' : undefined,
        speakerLabel: defaultLabel,
        text: clean,
        tokens: [],
        averageConfidence: Math.round((fallbackConfidence || 0.9) * 100) / 100,
        language: fallbackAltLang
      }
    ]
  }

  interface MutableRun {
    speakerNum?: number
    language?: string
    langCounts: Map<string, number>
    words: RelayedWord[]
  }

  const SENTENCE_END_WORD_REGEX = /[.!?。？！]["”'»)]*$/
  const normalizeWordLang = (lang?: string): string | undefined => {
    if (typeof lang !== 'string' || !lang.trim()) return undefined
    return lang.trim().toLowerCase().split(/[-_]/)[0] || undefined
  }
  const recordRunLang = (run: MutableRun, lang?: string): void => {
    if (!lang) return
    const nextCount = (run.langCounts.get(lang) || 0) + 1
    run.langCounts.set(lang, nextCount)
    const currentBest = run.language ? run.langCounts.get(run.language) || 0 : 0
    if (!run.language || nextCount >= currentBest) {
      run.language = lang
    }
  }

  const runs: MutableRun[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const textPiece = (w.punctuated_word || w.word || '').trim()
    if (!textPiece) continue
    const speakerNum = typeof w.speaker === 'number' && Number.isFinite(w.speaker) ? w.speaker : undefined
    const wordLang = normalizeWordLang(w.language)
    const lastRun = runs[runs.length - 1]
    if (!lastRun) {
      const created: MutableRun = { speakerNum, langCounts: new Map(), words: [w] }
      recordRunLang(created, wordLang)
      runs.push(created)
      continue
    }

    const isDifferentSpeaker =
      speakerNum !== undefined &&
      lastRun.speakerNum !== undefined &&
      speakerNum !== lastRun.speakerNum

    let isMidFrameLanguageSwitch = false
    const dominantLangCount = lastRun.language ? lastRun.langCounts.get(lastRun.language) || 0 : 0
    if (
      !isDifferentSpeaker &&
      dominantLangCount >= 2 &&
      wordLang &&
      lastRun.language &&
      wordLang !== lastRun.language
    ) {
      const prevWord = lastRun.words[lastRun.words.length - 1]
      const prevText = (prevWord?.punctuated_word || prevWord?.word || '').trim()
      const prevEndedSentence = SENTENCE_END_WORD_REGEX.test(prevText)
      const nextWordLang = i + 1 < words.length ? normalizeWordLang(words[i + 1].language) : undefined
      // Split on language switch at sentence boundary OR >= 2 consecutive words in new language
      // (requires >= 2 words of prior dominant language so opening cognates like "No," never false-split)
      if (prevEndedSentence || nextWordLang === wordLang) {
        isMidFrameLanguageSwitch = true
      }
    }

    if (isDifferentSpeaker || isMidFrameLanguageSwitch) {
      const created: MutableRun = { speakerNum, langCounts: new Map(), words: [w] }
      recordRunLang(created, wordLang)
      runs.push(created)
    } else {
      if (lastRun.speakerNum === undefined && speakerNum !== undefined) {
        lastRun.speakerNum = speakerNum
      }
      recordRunLang(lastRun, wordLang)
      lastRun.words.push(w)
    }
  }

  const segments: DeepgramSpeakerSegment[] = []
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    const run = runs[runIdx]
    const speakerId =
      run.speakerNum !== undefined ? String(run.speakerNum + 1) : channelId === 'channel_b' ? '1' : undefined
    const speakerLabel = speakerId ? `Speaker ${speakerId}` : defaultLabel

    let confSum = 0
    const langVotes = new Map<string, number>()
    let lastVotedLang: string | undefined
    const tokens: TranscriptToken[] = run.words.map((w, idx) => {
      const conf = typeof w.confidence === 'number' ? w.confidence : 0.88
      const roundedConf = Math.round(conf * 100) / 100
      confSum += roundedConf
      if (typeof w.language === 'string' && w.language.trim()) {
        const baseLang = w.language.trim().toLowerCase().split(/[-_]/)[0]
        if (baseLang) {
          langVotes.set(baseLang, (langVotes.get(baseLang) || 0) + 1)
          lastVotedLang = baseLang
        }
      }
      return {
        id: `${utteranceIdPrefix}-r${runIdx}-${idx}`,
        text: w.punctuated_word || w.word || '',
        confidence: roundedConf,
        isLowConfidence: roundedConf < confidenceThreshold,
        startTimeMs: Math.round((w.start || 0) * 1000),
        endTimeMs: Math.round((w.end || 0) * 1000),
        isPunctuated: Boolean(w.punctuated_word),
        speakerId
      }
    })

    // Majority vote over word languages avoids false switches from opening cognates ("No", "Doctor", "OK")
    let detectedLang: string | undefined = fallbackAltLang
    if (langVotes.size > 0) {
      let bestCount = -1
      for (const [lang, count] of langVotes.entries()) {
        if (count > bestCount || (count === bestCount && lang === lastVotedLang)) {
          bestCount = count
          detectedLang = lang
        }
      }
    }

    const joined = tokens
      .map((t) => t.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .trim()

    if (!joined) continue

    segments.push({
      speakerId,
      speakerLabel,
      text: joined,
      tokens,
      averageConfidence:
        tokens.length > 0
          ? Math.round((confSum / tokens.length) * 100) / 100
          : Math.round((fallbackConfidence || 0.9) * 100) / 100,
      language: detectedLang
    })
  }

  return segments
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
      languages?: string[]
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
  private allowConcurrencyRetryOnce: boolean = false
  private activeProvider: 'soniox-unified' | 'deepgram-nova-3' | 'deepgram-nova-2' =
    'soniox-unified'
  private sonioxAssembler: SonioxStreamAssembler
  private finalOriginalTokens: number = 0
  private finalTranslationTokens: number = 0
  private finalizesSent: number = 0

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
        sameLanguageSettleMs: 2200
      },
      {
        onUnifiedDraft: (snap) => this.callbacks.onUnifiedDraft?.(snap),
        onUnifiedCommit: (snap) => this.callbacks.onUnifiedCommit?.(snap),
        onUnifiedCommitUpdate: (snap) => this.callbacks.onUnifiedCommitUpdate?.(snap)
      }
    )
  }

  /**
   * Silently rotates the Bearer JWT in-place without disconnecting an active WebSocket call,
   * ensuring future automatic reconnections during 2-hour+ sessions always use a fresh token.
   */
  public updateAccessTokenSilently(nextToken: string): void {
    const cleaned = nextToken.trim()
    if (cleaned.length > 20) {
      this.accessToken = cleaned
    }
  }

  public connect(options?: { isReplacingSession?: boolean }): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    if (options?.isReplacingSession) {
      this.allowConcurrencyRetryOnce = true
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
        channel: this.channelId,
        route: this.channelId === 'channel_a' ? 'mic' : 'system'
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
        this.allowConcurrencyRetryOnce = false
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
          // During intentional mid-session reconnects (language/mode/domain switch), the new WS
          // upgrade can beat the prior socket's close frame across the network — retry once after 350ms.
          if (this.allowConcurrencyRetryOnce) {
            this.allowConcurrencyRetryOnce = false
            this.updateState('reconnecting', 'Switching session...')
            this.clearReconnectTimer()
            this.reconnectTimer = setTimeout(() => this.connect(), 350)
            return
          }
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

  private isDeepgramProvider(): boolean {
    return this.activeProvider === 'deepgram-nova-3' || this.activeProvider === 'deepgram-nova-2'
  }

  public signalSpeechEnd(): void {
    this.speechStartTimestamp = 0
    // Both Soniox and Deepgram use native endpointing + explicit 2.2s pause finalization
    // (finalizeTurn from SmartSpeechGate), avoiding premature mid-sentence chops on short VAD dips.
  }

  /**
   * Explicitly tells the active upstream engine (Soniox or Deepgram) to finalize all pending
   * words once audio goes silent for >2.2s, preventing stale provisional tails from repeating.
   */
  public finalizeTurn(): void {
    this.speechStartTimestamp = 0
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const msgType = this.isDeepgramProvider() ? 'Finalize' : 'finalize'
      this.socket.send(JSON.stringify({ type: msgType }))
      this.finalizesSent++
    }
  }

  public getTokenTelemetry(): {
    finalOriginalTokens: number
    finalTranslationTokens: number
    finalizesSent: number
  } {
    return {
      finalOriginalTokens: this.finalOriginalTokens,
      finalTranslationTokens: this.finalTranslationTokens,
      finalizesSent: this.finalizesSent
    }
  }

  public resetTokenTelemetry(): void {
    this.finalOriginalTokens = 0
    this.finalTranslationTokens = 0
    this.finalizesSent = 0
  }

  /**
   * Notifies the Gateway that this channel was explicitly muted/paused so it can finalize
   * any pending words and fast-hibernate the upstream WebSocket ($0 idle billing for both
   * Soniox and Deepgram).
   */
  public signalPause(): void {
    this.speechStartTimestamp = 0
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'pause' }))
    }
  }

  public getActiveProvider(): 'soniox-unified' | 'deepgram-nova-3' | 'deepgram-nova-2' {
    return this.activeProvider
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return

    try {
      const data = JSON.parse(event.data) as RelayedGatewayMessage

      if (data.type === 'dualai_quota') {
        if (data.provider === 'soniox-unified') {
          this.activeProvider = 'soniox-unified'
        } else if (data.provider === 'deepgram-nova-3') {
          this.activeProvider = 'deepgram-nova-3'
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
        if (data.code === 'SERVER_RESTARTING') {
          // Graceful server rolling restart (HTTP/WS 1001): reconnect silently without flashing an error banner
          this.updateState('reconnecting', 'Reconnecting...')
          return
        }
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

        for (const tok of data.tokens) {
          if (!tok || !tok.text || tok.text === '<end>' || tok.text === '<fin>') continue
          if (tok.is_final) {
            if (tok.translation_status === 'translation') {
              this.finalTranslationTokens++
            } else {
              this.finalOriginalTokens++
            }
          }
        }

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

      const isFinal = Boolean(data.is_final || data.speech_final)
      const isSpeechFinal = Boolean(data.speech_final)
      const baseUtteranceId = this.currentUtteranceId || `${this.channelId}-${Date.now()}`
      const speakerSegments = splitDeepgramWordsBySpeaker({
        words: alternative.words || [],
        fallbackTranscript: alternative.transcript,
        fallbackConfidence: alternative.confidence,
        alternativeLanguages: alternative.languages,
        channelId: this.channelId,
        utteranceIdPrefix: baseUtteranceId,
        confidenceThreshold: this.config.confidenceThreshold
      })

      if (speakerSegments.length === 0) return

      const telemetryProvider =
        this.activeProvider === 'deepgram-nova-3' ? 'deepgram-nova-3' : 'deepgram-nova-2'
      const totalTokens = speakerSegments.reduce((sum, seg) => sum + seg.tokens.length, 0)

      if (isFinal) {
        this.finalOriginalTokens += totalTokens
      }

      this.callbacks.onTelemetry({
        channelId: this.channelId,
        latencyMs,
        tokensCount: totalTokens,
        connectionState: this.connectionState,
        reconnectCount: this.reconnectAttempts,
        provider: telemetryProvider
      })

      const isConversationMode = (this.config.operatingMode || 'conversation') === 'conversation'

      for (let idx = 0; idx < speakerSegments.length; idx++) {
        const seg = speakerSegments[idx]
        // In Conversation mode (language=multi), omit language when Deepgram did not tag it so
        // ParagraphTurnAccumulator inherits the active speaker's language instead of falsely switching.
        const resolvedLanguage = seg.language || (isConversationMode ? '' : this.config.language)
        const utterance: TranscriptUtterance = {
          id: speakerSegments.length === 1 ? baseUtteranceId : `${baseUtteranceId}-s${idx}`,
          channelId: this.channelId,
          speakerId: seg.speakerId,
          speakerLabel: seg.speakerLabel,
          language: resolvedLanguage,
          text: seg.text,
          tokens: seg.tokens,
          isFinal,
          speechFinal: isSpeechFinal && idx === speakerSegments.length - 1,
          timestampMs: Date.now(),
          durationMs: data.duration ? Math.round(data.duration * 1000) : 0,
          averageConfidence: seg.averageConfidence,
          receivedAtMs: Date.now()
        }

        if (isFinal) {
          this.callbacks.onFinalTranscript(utterance)
        } else {
          this.callbacks.onInterimTranscript(utterance)
        }
      }

      if (isFinal) {
        this.currentUtteranceId = ''
        this.speechStartTimestamp = 0
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
        // Gateway absorbs keepalive cleanly while upstream (Soniox or Deepgram) is hibernated.
        // 5000ms interval safely beats Deepgram's 10s NET-0001 idle timeout with network jitter.
        const keepaliveType = this.isDeepgramProvider() ? 'KeepAlive' : 'keepalive'
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
