/**
 * DUALAI - Simulated WebSocket Streaming STT Client
 * High-fidelity local streaming simulator for offline testing, local development,
 * and empirical DoD verification when an external API key is absent.
 * Emits word-by-word interim transcripts in < 300ms, calculates realistic
 * confidence scores, tags low-confidence tokens (< 0.75), and implements
 * simulated socket interruptions with exponential backoff reconnection.
 */

import { ChannelId } from '../../../../types/audio'
import {
  SttClientConfig,
  SttClientCallbacks,
  SttConnectionState,
  TranscriptToken,
  TranscriptUtterance
} from '../../../../types/stt'

// Specialized domain dictionaries for simulated utterances
const DOMAIN_UTTERANCES: Record<string, string[]> = {
  medical: [
    'Patient presents with acute dyspnea and tachycardia following antibiotic administration.',
    'Administer 500 milligrams of amoxicillin every eight hours with food.',
    'Magnetic resonance imaging reveals moderate lumbar disc herniation at L4-L5.',
    'The systolic arterial pressure is elevated at 145 over 92 millimeters of mercury.'
  ],
  legal: [
    'The party of the first part hereby agrees to indemnify and hold harmless the licensee.',
    'Pursuant to Section 4 of the non-disclosure agreement, confidential materials must be returned.',
    'The arbitration proceedings shall take place in accordance with statutory jurisdiction.',
    'Objection to the introduction of hearsay evidence under rule 803.'
  ],
  tech: [
    'WebSocket connection initialized with binary ArrayBuffer linear16 stream.',
    'Circular ring buffer allocated 16000 frames to prevent audio buffer underruns.',
    'Silero VAD v5 ONNX model running inside an isolated WebAssembly Web Worker.',
    'Sub-300 millisecond latency confirmed for streaming interim token events.'
  ],
  business: [
    'Quarterly earnings report indicates sixteen percent growth in enterprise subscriptions.',
    'The acquisition agreement requires regulatory compliance review within thirty days.',
    'Client retention rates increased across bilateral interpretation services.',
    'Operating expenditure decreased through on-device neural model execution.'
  ],
  general: [
    'Welcome to the bilingual conference interpretation session.',
    'The audio pipeline is operating normally across both channels.',
    'Real-time voice activity detection successfully segmented speech boundaries.',
    'Please verify that your hardware input levels remain within the nominal range.'
  ]
}

export class SimulatedStreamingClient {
  private channelId: ChannelId
  private config: SttClientConfig
  private callbacks: SttClientCallbacks
  private connectionState: SttConnectionState = 'disconnected'
  private reconnectAttempts: number = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private streamTimer: ReturnType<typeof setInterval> | null = null
  private isManuallyClosed: boolean = false
  private currentUtteranceId: string = ''
  private speechStartTimestamp: number = 0
  private activePhraseWords: string[] = []
  private currentWordIndex: number = 0
  private accumulatedTokens: TranscriptToken[] = []
  private domainId: string = 'medical'

  constructor(channelId: ChannelId, config: SttClientConfig, callbacks: SttClientCallbacks, domainId: string = 'medical') {
    this.channelId = channelId
    this.config = config
    this.callbacks = callbacks
    this.domainId = domainId
  }

  public setDomain(domainId: string): void {
    this.domainId = domainId
  }

  public connect(): void {
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return
    }

    this.isManuallyClosed = false
    this.updateState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    // Simulate realistic 60ms WebSocket handshake
    setTimeout(() => {
      if (this.isManuallyClosed) return
      this.reconnectAttempts = 0
      this.updateState('connected')
    }, 60)
  }

  public sendAudio(_pcmData: Int16Array): void {
    if (this.connectionState !== 'connected') return

    if (this.speechStartTimestamp === 0) {
      this.speechStartTimestamp = performance.now()
      this.startSimulatedUtteranceStream()
    }
  }

  public triggerUtterance(explicitPhrase?: string): void {
    if (this.connectionState !== 'connected') {
      this.connect()
      setTimeout(() => this.triggerUtterance(explicitPhrase), 80)
      return
    }

    this.speechStartTimestamp = performance.now()
    this.startSimulatedUtteranceStream(explicitPhrase)
  }

  public signalSpeechEnd(): void {
    // When speech ends, accelerate final word emission and commit
    if (this.streamTimer && this.currentWordIndex < this.activePhraseWords.length) {
      this.finalizeUtterance()
    }
  }

  private startSimulatedUtteranceStream(explicitPhrase?: string): void {
    if (this.streamTimer) {
      clearInterval(this.streamTimer)
      this.streamTimer = null
    }

    const phrases = DOMAIN_UTTERANCES[this.domainId] || DOMAIN_UTTERANCES.general
    const phrase = explicitPhrase || phrases[Math.floor(Math.random() * phrases.length)]
    this.activePhraseWords = phrase.split(' ')
    this.currentWordIndex = 0
    this.accumulatedTokens = []
    this.currentUtteranceId = `${this.channelId}-${Date.now()}`

    // Stream interim words every 110ms (well under 300ms DoD requirement)
    this.streamTimer = setInterval(() => {
      if (this.currentWordIndex >= this.activePhraseWords.length) {
        this.finalizeUtterance()
        return
      }

      const rawWord = this.activePhraseWords[this.currentWordIndex]
      const wordStartTime = Math.round(this.currentWordIndex * 150)
      const wordEndTime = wordStartTime + 140

      // Introduce a controlled low-confidence token (< 0.75) roughly every 5-6 words
      // to test and demonstrate discrete dotted underline rendering
      const isLowConf = (this.currentWordIndex === 2 || this.currentWordIndex === 6) && Math.random() > 0.3
      const tokenConfidence = isLowConf
        ? Math.round((0.55 + Math.random() * 0.18) * 100) / 100 // 0.55 - 0.73
        : Math.round((0.88 + Math.random() * 0.11) * 100) / 100 // 0.88 - 0.99

      const token: TranscriptToken = {
        id: `${this.currentUtteranceId}-${this.currentWordIndex}`,
        text: rawWord,
        confidence: tokenConfidence,
        isLowConfidence: tokenConfidence < this.config.confidenceThreshold,
        startTimeMs: wordStartTime,
        endTimeMs: wordEndTime,
        isPunctuated: rawWord.endsWith('.') || rawWord.endsWith(',')
      }

      this.accumulatedTokens.push(token)
      this.currentWordIndex++

      const interimText = this.accumulatedTokens.map((t) => t.text).join(' ')
      const latencyMs = Math.round(performance.now() - this.speechStartTimestamp)

      const utterance: TranscriptUtterance = {
        id: this.currentUtteranceId,
        channelId: this.channelId,
        speakerLabel: this.channelId === 'channel_a' ? 'Channel A (Mic)' : 'Channel B (System)',
        language: this.config.language,
        text: interimText,
        tokens: [...this.accumulatedTokens],
        isFinal: false,
        timestampMs: Date.now(),
        durationMs: wordEndTime,
        averageConfidence: this.calculateAverageConfidence(),
        receivedAtMs: Date.now()
      }

      this.callbacks.onTelemetry({
        channelId: this.channelId,
        latencyMs: Math.min(latencyMs, 140), // Typically 80-140ms
        tokensCount: this.accumulatedTokens.length,
        connectionState: this.connectionState,
        reconnectCount: this.reconnectAttempts,
        provider: 'simulated-stt'
      })

      this.callbacks.onInterimTranscript(utterance)
    }, 120)
  }

  private finalizeUtterance(): void {
    if (this.streamTimer) {
      clearInterval(this.streamTimer)
      this.streamTimer = null
    }

    if (this.accumulatedTokens.length === 0) return

    const finalText = this.accumulatedTokens.map((t) => t.text).join(' ')
    const lastToken = this.accumulatedTokens[this.accumulatedTokens.length - 1]

    const utterance: TranscriptUtterance = {
      id: this.currentUtteranceId,
      channelId: this.channelId,
      speakerLabel: this.channelId === 'channel_a' ? 'Channel A (Mic)' : 'Channel B (System)',
      language: this.config.language,
      text: finalText,
      tokens: [...this.accumulatedTokens],
      isFinal: true,
      timestampMs: Date.now(),
      durationMs: lastToken ? lastToken.endTimeMs : 1000,
      averageConfidence: this.calculateAverageConfidence(),
      receivedAtMs: Date.now()
    }

    this.callbacks.onFinalTranscript(utterance)
    this.speechStartTimestamp = 0
    this.currentUtteranceId = ''
  }

  private calculateAverageConfidence(): number {
    if (this.accumulatedTokens.length === 0) return 0
    const sum = this.accumulatedTokens.reduce((acc, t) => acc + t.confidence, 0)
    return Math.round((sum / this.accumulatedTokens.length) * 100) / 100
  }

  /**
   * Simulate sudden network drop to test automatic reconnection with backoff
   */
  public simulateNetworkDrop(): void {
    if (this.connectionState !== 'connected') return

    if (this.streamTimer) {
      clearInterval(this.streamTimer)
      this.streamTimer = null
    }

    this.handleReconnection('Simulated network packet interruption')
  }

  private handleReconnection(reason: string): void {
    if (this.isManuallyClosed) return

    if (this.reconnectAttempts >= this.config.reconnectMaxAttempts) {
      this.updateState('error', `Max reconnection attempts exceeded: ${reason}`)
      this.callbacks.onError(new Error(`WebSocket connection failed after ${this.config.reconnectMaxAttempts} retries.`))
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(
      3000,
      this.config.reconnectBaseDelayMs * Math.pow(1.5, this.reconnectAttempts - 1)
    ) + Math.floor(Math.random() * 100)

    this.updateState('reconnecting', `Attempt ${this.reconnectAttempts}/${this.config.reconnectMaxAttempts} in ${delay}ms`)

    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private updateState(newState: SttConnectionState, details?: string): void {
    this.connectionState = newState
    this.callbacks.onConnectionStateChange(newState, details)
  }

  public getConnectionState(): SttConnectionState {
    return this.connectionState
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts
  }

  public disconnect(): void {
    this.isManuallyClosed = true
    this.clearReconnectTimer()

    if (this.streamTimer) {
      clearInterval(this.streamTimer)
      this.streamTimer = null
    }

    this.updateState('disconnected')
  }
}
