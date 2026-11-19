/**
 * DUALAI - Low-Latency Audio Engine Type Definitions
 * Strict TypeScript models for dual-channel audio ingestion,
 * voice activity detection, and hardware metering.
 */

export type SampleRate = 16000 | 48000

export type ChannelId = 'channel_a' | 'channel_b'

export type AudioRouteMode =
  | 'mic'
  | 'system'
  | 'bilateral'
  | 'app'

export type OperatingMode =
  | 'translate'
  | 'conversation'

export type LatencyMode =
  | 'sub_second_live'
  | 'sentence_accurate'

export type VADState =
  | 'silence'
  | 'speech_onset'
  | 'active_speech'
  | 'speech_offset'

export interface VADConfig {
  threshold: number
  minSpeechDurationMs: number
  minSilenceDurationMs: number
  preSpeechPadFrames: number
  sampleRate: SampleRate
}

export interface VADEvent {
  channelId: ChannelId
  state: VADState
  probability: number
  timestampMs: number
  frameIndex: number
}

export interface AudioLevelMetric {
  channelId: ChannelId
  rmsDb: number
  peakDb: number
  isClipping: boolean
  timestampMs: number
}

export interface AudioDeviceInfo {
  deviceId: string
  label: string
  groupId: string
  kind: 'audioinput' | 'audiooutput'
  isDefault: boolean
}

export interface AudioChannelConfig {
  channelId: ChannelId
  deviceId: string
  gainMultiplier: number
  sampleRate: SampleRate
  bufferSizeFrames: number
  noiseSuppression: boolean
  echoCancellation: boolean
}

export interface LatencyTelemetry {
  audioIngestMs: number
  vadLatencyMs: number
  sttLatencyMs: number
  translationLatencyMs: number
  totalRoundtripMs: number
  measuredAtMs: number
}
