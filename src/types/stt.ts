/**
 * DUALAI - Streaming Speech-to-Text (STT) Type Definitions
 * Strict TypeScript models for bidirectional WebSocket STT streaming,
 * interim word events, confidence scoring, and socket lifecycle management.
 */

import { ChannelId } from './audio'

export type SttModel = 'soniox-rt' | 'nova-2' | 'whisper-turbo'

export type SttConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface TranscriptToken {
  id: string
  text: string
  confidence: number // 0.0 to 1.0
  isLowConfidence: boolean // True if confidence < 0.75
  startTimeMs: number
  endTimeMs: number
  isPunctuated?: boolean
  speakerId?: string
}

export interface TranscriptUtterance {
  id: string
  channelId: ChannelId
  speakerId?: string
  speakerLabel: string
  language: string
  text: string
  tokens: TranscriptToken[]
  isFinal: boolean
  timestampMs: number
  durationMs: number
  averageConfidence: number
  receivedAtMs: number
}

export interface SttTelemetry {
  channelId: ChannelId
  latencyMs: number
  tokensCount: number
  connectionState: SttConnectionState
  reconnectCount: number
  provider: 'soniox-unified' | 'deepgram-nova-2' | 'whisper-turbo' | 'simulated-stt'
}

export interface SttClientConfig {
  apiKey?: string
  endpointUrl?: string
  model: SttModel
  language: string
  targetLanguage?: string
  operatingMode?: 'translate' | 'conversation'
  domainId?: string
  glossaryTerms?: string[]
  sampleRate: number
  confidenceThreshold: number
  interimResults: boolean
  smartFormat: boolean
  endpointingMs?: number
  reconnectMaxAttempts: number
  reconnectBaseDelayMs: number
}

export interface SttClientCallbacks {
  onInterimTranscript: (utterance: TranscriptUtterance) => void
  onFinalTranscript: (utterance: TranscriptUtterance) => void
  onConnectionStateChange: (state: SttConnectionState, details?: string) => void
  onTelemetry: (telemetry: SttTelemetry) => void
  onError: (error: Error) => void
}
