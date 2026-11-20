/**
 * DUALAI - Streaming STT Manager
 * Orchestrates dual-channel speech-to-text clients (Channel A Mic + Channel B Loopback).
 * Auto-selects between live Deepgram Nova-2 WebSocket and high-fidelity Simulated client.
 * Enforces zero-leak cleanup and dispatches unified interim and final transcript events.
 */

import { ChannelId } from '../../../../types/audio'
import {
  SttClientConfig,
  SttClientCallbacks,
  SttConnectionState,
  SttTelemetry,
  TranscriptUtterance
} from '../../../../types/stt'
import { DeepgramStreamingClient } from './DeepgramStreamingClient'
import { SimulatedStreamingClient } from './SimulatedStreamingClient'

export interface SttManagerCallbacks {
  onInterimTranscript: (utterance: TranscriptUtterance) => void
  onFinalTranscript: (utterance: TranscriptUtterance) => void
  onConnectionChange: (channelId: ChannelId, state: SttConnectionState, details?: string) => void
  onTelemetry: (telemetry: SttTelemetry) => void
  onError: (channelId: ChannelId, error: Error) => void
}

type SttClientInstance = DeepgramStreamingClient | SimulatedStreamingClient

export class StreamingSttManager {
  private clientA: SttClientInstance | null = null
  private clientB: SttClientInstance | null = null
  private callbacks: SttManagerCallbacks
  private isRunning: boolean = false
  private apiKey?: string
  private languageA: string = 'en'
  private languageB: string = 'es'
  private domainId: string = 'medical'
  private confidenceThreshold: number = 0.75

  constructor(callbacks: SttManagerCallbacks, options?: { apiKey?: string; domainId?: string; confidenceThreshold?: number }) {
    this.callbacks = callbacks
    this.apiKey = options?.apiKey || import.meta.env.VITE_DEEPGRAM_API_KEY
    this.domainId = options?.domainId || 'medical'
    this.confidenceThreshold = options?.confidenceThreshold ?? 0.75
  }

  public updateLanguages(langA: string, langB: string): void {
    this.languageA = langA
    this.languageB = langB
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

    this.clientA = this.createClient('channel_a', this.languageA)
    this.clientB = this.createClient('channel_b', this.languageB)

    this.clientA.connect()
    this.clientB.connect()
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
      apiKey: this.apiKey,
      model: 'nova-2',
      language,
      sampleRate: 16000,
      confidenceThreshold: this.confidenceThreshold,
      interimResults: true,
      smartFormat: true,
      reconnectMaxAttempts: 5,
      reconnectBaseDelayMs: 600
    }

    const callbacks: SttClientCallbacks = {
      onInterimTranscript: (utterance) => {
        this.callbacks.onInterimTranscript(utterance)
      },
      onFinalTranscript: (utterance) => {
        this.callbacks.onFinalTranscript(utterance)
      },
      onConnectionStateChange: (state, details) => {
        this.callbacks.onConnectionChange(channelId, state, details)
      },
      onTelemetry: (telemetry) => {
        this.callbacks.onTelemetry(telemetry)
      },
      onError: (err) => {
        this.callbacks.onError(channelId, err)
      }
    }

    // If an active API key is provided and valid, use DeepgramStreamingClient; otherwise use SimulatedStreamingClient
    if (this.apiKey && this.apiKey.trim().length > 10 && this.apiKey !== 'your_deepgram_api_key_here') {
      return new DeepgramStreamingClient(channelId, config, callbacks)
    }

    return new SimulatedStreamingClient(channelId, config, callbacks, this.domainId)
  }
}
