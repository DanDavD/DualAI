/**
 * DUALAI - Deepgram Nova-2 WebSocket Streaming Client
 * Production bidirectional WebSocket client for sub-300ms continuous Speech-to-Text.
 * Handles binary linear16 PCM streaming, interim word event dispatch,
 * confidence scoring with low-confidence token tagging (< 0.75),
 * keepalive heartbeats, and exponential backoff automatic reconnection.
 */

import { ChannelId } from '../../../../types/audio'
import {
  SttClientConfig,
  SttClientCallbacks,
  SttConnectionState,
  TranscriptToken,
  TranscriptUtterance
} from '../../../../types/stt'

interface DeepgramWord {
  word: string
  start: number
  end: number
  confidence: number
  punctuated_word?: string
}

interface DeepgramAlternative {
  transcript: string
  confidence: number
  words: DeepgramWord[]
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[]
}

interface DeepgramMessage {
  type?: string
  channel_index?: number[]
  duration?: number
  start?: number
  is_final?: boolean
  speech_final?: boolean
  channel?: DeepgramChannel
}

export class DeepgramStreamingClient {
  private channelId: ChannelId
  private config: SttClientConfig
  private callbacks: SttClientCallbacks
  private socket: WebSocket | null = null
  private connectionState: SttConnectionState = 'disconnected'
  private reconnectAttempts: number = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null
  private speechStartTimestamp: number = 0
  private currentUtteranceId: string = ''
  private isManuallyClosed: boolean = false

  constructor(channelId: ChannelId, config: SttClientConfig, callbacks: SttClientCallbacks) {
    this.channelId = channelId
    this.config = config
    this.callbacks = callbacks
  }

  public connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    if (!this.config.apiKey) {
      this.updateState('error', 'Missing Deepgram API key')
      this.callbacks.onError(new Error('Deepgram API key is required for live WebSocket streaming'))
      return
    }

    this.isManuallyClosed = false
    this.updateState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    try {
      const baseUrl = this.config.endpointUrl || 'wss://api.deepgram.com/v1/listen'
      const queryParams = new URLSearchParams({
        model: this.config.model,
        encoding: 'linear16',
        sample_rate: this.config.sampleRate.toString(),
        channels: '1',
        interim_results: this.config.interimResults ? 'true' : 'false',
        smart_format: this.config.smartFormat ? 'true' : 'false',
        endpointing: '300',
        language: this.config.language
      })

      const wsUrl = `${baseUrl}?${queryParams.toString()}`

      // Browser WebSocket authentication via subprotocol
      this.socket = new WebSocket(wsUrl, ['token', this.config.apiKey])
      this.socket.binaryType = 'arraybuffer'

      this.socket.onopen = () => {
        this.reconnectAttempts = 0
        this.updateState('connected')
        this.startKeepalive()
      }

      this.socket.onmessage = (event: MessageEvent) => {
        this.handleMessage(event)
      }

      this.socket.onerror = (err) => {
        console.warn(`[DUALAI-STT] Socket error on ${this.channelId}:`, err)
      }

      this.socket.onclose = (event: CloseEvent) => {
        this.stopKeepalive()
        this.socket = null

        if (this.isManuallyClosed) {
          this.updateState('disconnected')
          return
        }

        if (event.code === 1000) {
          this.updateState('disconnected')
        } else {
          this.handleReconnection(`Socket closed unexpectedly (code: ${event.code})`)
        }
      }
    } catch (err) {
      this.handleReconnection(`Connection failure: ${(err as Error).message}`)
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

    // Direct binary transmission of PCM ArrayBuffer
    if (pcmData.buffer instanceof ArrayBuffer) {
      this.socket.send(pcmData.buffer)
    }
  }

  public signalSpeechEnd(): void {
    this.speechStartTimestamp = 0
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // Send finalize control frame to Deepgram
      const finalizeMsg = JSON.stringify({ type: 'Finalize' })
      this.socket.send(finalizeMsg)
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return

    try {
      const data: DeepgramMessage = JSON.parse(event.data)
      const alternative = data.channel?.alternatives?.[0]

      if (!alternative || !alternative.transcript) {
        return
      }

      const now = performance.now()
      const latencyMs = this.speechStartTimestamp > 0
        ? Math.max(12, Math.round(now - this.speechStartTimestamp))
        : 45

      const words = alternative.words || []
      const tokens: TranscriptToken[] = words.map((w, idx) => {
        const conf = typeof w.confidence === 'number' ? w.confidence : 0.8
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

      // Telemetry dispatch
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
    } catch (parseErr) {
      console.warn(`[DUALAI-STT] Failed to parse WebSocket payload:`, parseErr)
    }
  }

  private handleReconnection(reason: string): void {
    if (this.isManuallyClosed) return

    if (this.reconnectAttempts >= this.config.reconnectMaxAttempts) {
      this.updateState('error', `Max reconnection attempts (${this.config.reconnectMaxAttempts}) exceeded: ${reason}`)
      this.callbacks.onError(new Error(`WebSocket connection failed after ${this.config.reconnectMaxAttempts} retries.`))
      return
    }

    this.reconnectAttempts++
    // Exponential backoff with jitter
    const delay = Math.min(
      5000,
      this.config.reconnectBaseDelayMs * Math.pow(1.5, this.reconnectAttempts - 1)
    ) + Math.floor(Math.random() * 200)

    this.updateState('reconnecting', `Attempt ${this.reconnectAttempts}/${this.config.reconnectMaxAttempts} in ${delay}ms`)

    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private startKeepalive(): void {
    this.stopKeepalive()
    this.keepaliveTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'KeepAlive' }))
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
    this.stopKeepalive()

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
