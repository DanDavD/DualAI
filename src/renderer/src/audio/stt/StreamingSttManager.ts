/**
 * DUALAI - Zero-Trust Streaming STT Manager
 * Orchestrates dual-channel speech-to-text clients (Channel A Mic + Channel B Loopback).
 * Connects strictly to the authenticated DualAI Cloud Gateway (GatewaySttClient) when signed in,
 * or falls back to SimulatedStreamingClient when offline.
 * ZERO upstream Deepgram API keys ever exist in this module or renderer bundle.
 */

import { ChannelId } from '../../../../types/audio'
import {
  SttClientConfig,
  SttClientCallbacks,
  SttConnectionState,
  SttTelemetry,
  TranscriptUtterance
} from '../../../../types/stt'
import { GatewaySttClient } from './GatewaySttClient'
import { SimulatedStreamingClient } from './SimulatedStreamingClient'

export interface SttManagerCallbacks {
  onInterimTranscript: (utterance: TranscriptUtterance) => void
  onFinalTranscript: (utterance: TranscriptUtterance) => void
  onConnectionChange: (channelId: ChannelId, state: SttConnectionState, details?: string) => void
  onTelemetry: (telemetry: SttTelemetry) => void
  onError: (channelId: ChannelId, error: Error) => void
  onQuotaUpdate?: (remainingSeconds: number, totalAllocatedSeconds: number) => void
  onQuotaExhausted?: (message: string) => void
}

export interface SttRoutingConfig {
  languageA: string
  languageB: string
  enableChannelA: boolean
  enableChannelB: boolean
  endpointingMs?: number
}

type SttClientInstance = GatewaySttClient | SimulatedStreamingClient

export class StreamingSttManager {
  private clientA: SttClientInstance | null = null
  private clientB: SttClientInstance | null = null
  private callbacks: SttManagerCallbacks
  private isRunning: boolean = false
  private accessToken: string | null = null
  private languageA: string = 'en'
  private languageB: string = 'es'
  private enableChannelA: boolean = true
  private enableChannelB: boolean = true
  private endpointingMs: number = 250
  private domainId: string = 'medical'
  private confidenceThreshold: number = 0.75

  constructor(
    callbacks: SttManagerCallbacks,
    options?: { accessToken?: string | null; domainId?: string; confidenceThreshold?: number }
  ) {
    this.callbacks = callbacks
    this.accessToken = options?.accessToken || null
    this.domainId = options?.domainId || 'medical'
    this.confidenceThreshold = options?.confidenceThreshold ?? 0.75
  }

  public isGatewayAuthenticated(): boolean {
    return Boolean(this.accessToken && this.accessToken.length > 20)
  }

  public setAccessToken(token: string | null): void {
    const normalized = token && token.trim().length > 20 ? token.trim() : null
    const changed = normalized !== this.accessToken
    this.accessToken = normalized

    if (this.isRunning && changed) {
      this.reconnectChannel('channel_a', this.enableChannelA)
      this.reconnectChannel('channel_b', this.enableChannelB)
    }
  }

  public updateLanguages(langA: string, langB: string): void {
    this.updateRouting({
      languageA: langA,
      languageB: langB,
      enableChannelA: this.enableChannelA,
      enableChannelB: this.enableChannelB,
      endpointingMs: this.endpointingMs
    })
  }

  public updateRouting(routing: SttRoutingConfig): void {
    const langAChanged = routing.languageA !== this.languageA
    const langBChanged = routing.languageB !== this.languageB
    const enableAChanged = routing.enableChannelA !== this.enableChannelA
    const enableBChanged = routing.enableChannelB !== this.enableChannelB
    const nextEndpointing = routing.endpointingMs ?? this.endpointingMs
    const endpointingChanged = nextEndpointing !== this.endpointingMs

    this.languageA = routing.languageA
    this.languageB = routing.languageB
    this.enableChannelA = routing.enableChannelA
    this.enableChannelB = routing.enableChannelB
    this.endpointingMs = nextEndpointing

    if (!this.isRunning) return

    if (langAChanged || enableAChanged || endpointingChanged) {
      this.reconnectChannel('channel_a', this.enableChannelA)
    }
    if (langBChanged || enableBChanged || endpointingChanged) {
      this.reconnectChannel('channel_b', this.enableChannelB)
    }
  }

  private reconnectChannel(channelId: ChannelId, enabled: boolean): void {
    if (channelId === 'channel_a') {
      if (this.clientA) {
        this.clientA.disconnect()
        this.clientA = null
      }
      if (enabled) {
        this.clientA = this.createClient('channel_a', this.languageA)
        this.clientA.connect()
      } else {
        this.callbacks.onConnectionChange('channel_a', 'disconnected')
      }
    } else {
      if (this.clientB) {
        this.clientB.disconnect()
        this.clientB = null
      }
      if (enabled) {
        this.clientB = this.createClient('channel_b', this.languageB)
        this.clientB.connect()
      } else {
        this.callbacks.onConnectionChange('channel_b', 'disconnected')
      }
    }
  }

  public updateDomain(domainId: string): void {
    this.domainId = domainId
    if (this.clientA instanceof SimulatedStreamingClient) {
      this.clientA.setDomain(domainId)
    }
    if (this.clientB instanceof SimulatedStreamingClient) {
      this.clientB.setDomain(domainId)
    }
  }

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true

    if (this.enableChannelA) {
      this.clientA = this.createClient('channel_a', this.languageA)
      this.clientA.connect()
    } else {
      this.callbacks.onConnectionChange('channel_a', 'disconnected')
    }

    if (this.enableChannelB) {
      this.clientB = this.createClient('channel_b', this.languageB)
      this.clientB.connect()
    } else {
      this.callbacks.onConnectionChange('channel_b', 'disconnected')
    }
  }

  public sendAudio(channelId: ChannelId, pcmData: Int16Array): void {
    if (!this.isRunning) return

    if (channelId === 'channel_a' && this.clientA) {
      this.clientA.sendAudio(pcmData)
    } else if (channelId === 'channel_b' && this.clientB) {
      this.clientB.sendAudio(pcmData)
    }
  }

  public signalSpeechEnd(channelId: ChannelId): void {
    if (channelId === 'channel_a' && this.clientA) {
      this.clientA.signalSpeechEnd()
    } else if (channelId === 'channel_b' && this.clientB) {
      this.clientB.signalSpeechEnd()
    }
  }

  public triggerTestUtterance(channelId: ChannelId, phrase?: string): void {
    const client = channelId === 'channel_a' ? this.clientA : this.clientB
    if (client instanceof SimulatedStreamingClient) {
      client.triggerUtterance(phrase)
    }
  }

  public simulateNetworkDrop(channelId?: ChannelId): void {
    if (!channelId || channelId === 'channel_a') {
      if (this.clientA instanceof SimulatedStreamingClient) {
        this.clientA.simulateNetworkDrop()
      }
    }
    if (!channelId || channelId === 'channel_b') {
      if (this.clientB instanceof SimulatedStreamingClient) {
        this.clientB.simulateNetworkDrop()
      }
    }
  }

  public stop(): void {
    this.isRunning = false

    if (this.clientA) {
      this.clientA.disconnect()
      this.clientA = null
    }

    if (this.clientB) {
      this.clientB.disconnect()
      this.clientB = null
    }
  }

  private createClient(channelId: ChannelId, language: string): SttClientInstance {
    const config: SttClientConfig = {
      model: 'nova-2',
      language,
      sampleRate: 16000,
      confidenceThreshold: this.confidenceThreshold,
      interimResults: true,
      smartFormat: true,
      endpointingMs: this.endpointingMs,
      reconnectMaxAttempts: 5,
      reconnectBaseDelayMs: 600
    }

    const callbacks: SttClientCallbacks = {
      onInterimTranscript: (utterance) => this.callbacks.onInterimTranscript(utterance),
      onFinalTranscript: (utterance) => this.callbacks.onFinalTranscript(utterance),
      onConnectionStateChange: (state, details) =>
        this.callbacks.onConnectionChange(channelId, state, details),
      onTelemetry: (telemetry) => this.callbacks.onTelemetry(telemetry),
      onError: (err) => this.callbacks.onError(channelId, err)
    }

    if (this.accessToken) {
      return new GatewaySttClient(channelId, config, this.accessToken, {
        ...callbacks,
        onQuotaUpdate: this.callbacks.onQuotaUpdate,
        onQuotaExhausted: this.callbacks.onQuotaExhausted
      })
    }

    return new SimulatedStreamingClient(channelId, config, callbacks, this.domainId)
  }
}
