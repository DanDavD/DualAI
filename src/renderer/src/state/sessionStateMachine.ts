/**
 * DUALAI - Master Session Finite State Machine (Day 09)
 * Links Audio Ingestion, Silero VAD v5, Streaming STT, Gemini Translation,
 * Instantaneous Cough/Mute Buffer, and UI readout states deterministically.
 */

import { SystemPipelineState } from '../../../types/settings'
import { SttConnectionState } from '../../../types/stt'

export interface PipelineInputs {
  isAudioActive: boolean
  isInitializing: boolean
  isMuted: boolean
  isSpeechActiveA: boolean
  isSpeechActiveB: boolean
  hasInterimTranscript: boolean
  isTranslating: boolean
  sttStatusA: SttConnectionState
  sttStatusB: SttConnectionState
  hasError: boolean
  bufferSamplesA: number
  bufferSamplesB: number
  sampleRate?: number
}

export interface PipelineStateSnapshot {
  state: SystemPipelineState
  label: string
  bufferMs: number
  isLive: boolean
  accentToken: 'muted' | 'steel' | 'emerald' | 'amber' | 'crimson'
}

/**
 * Resolve deterministic master state from concurrent subsystem telemetry.
 * Priority hierarchy:
 * 1. Error
 * 2. Initializing
 * 3. Idle (Audio capture stopped)
 * 4. Muted (Instantaneous zero-gain cough mute takes absolute precedence over speech)
 * 5. Reconnecting (WebSocket recovery in progress)
 * 6. Translating (Active Gemini 2.0 Flash token stream)
 * 7. Transcribing (VAD speech onset or active interim STT words)
 * 8. Listening (Pipeline armed and monitoring acoustic floor)
 */
export function resolvePipelineState(inputs: PipelineInputs): PipelineStateSnapshot {
  const sampleRate = inputs.sampleRate || 16000
  const maxSamples = Math.max(inputs.bufferSamplesA, inputs.bufferSamplesB)
  const bufferMs = Math.round((maxSamples / sampleRate) * 1000)

  if (inputs.hasError) {
    return {
      state: 'error',
      label: 'PIPELINE ERROR',
      bufferMs,
      isLive: false,
      accentToken: 'crimson'
    }
  }

  if (inputs.isInitializing) {
    return {
      state: 'initializing',
      label: 'INITIALIZING',
      bufferMs,
      isLive: false,
      accentToken: 'steel'
    }
  }

  if (!inputs.isAudioActive) {
    return {
      state: 'idle',
      label: 'IDLE',
      bufferMs: 0,
      isLive: false,
      accentToken: 'muted'
    }
  }

  if (inputs.isMuted) {
    return {
      state: 'muted',
      label: 'COUGH MUTE (0dB)',
      bufferMs: 0,
      isLive: true,
      accentToken: 'crimson'
    }
  }

  if (inputs.sttStatusA === 'reconnecting' || inputs.sttStatusB === 'reconnecting') {
    return {
      state: 'reconnecting',
      label: 'RECONNECTING',
      bufferMs,
      isLive: true,
      accentToken: 'amber'
    }
  }

  if (inputs.isTranslating) {
    return {
      state: 'translating',
      label: 'TRANSLATING',
      bufferMs,
      isLive: true,
      accentToken: 'emerald'
    }
  }

  if (inputs.isSpeechActiveA || inputs.isSpeechActiveB || inputs.hasInterimTranscript) {
    return {
      state: 'transcribing',
      label: 'TRANSCRIBING',
      bufferMs,
      isLive: true,
      accentToken: 'steel'
    }
  }

  return {
    state: 'listening',
    label: 'LISTENING',
    bufferMs: Math.max(bufferMs, 30),
    isLive: true,
    accentToken: 'emerald'
  }
}

export const ALLOWED_TRANSITIONS: Record<SystemPipelineState, SystemPipelineState[]> = {
  idle: ['initializing', 'listening', 'error'],
  initializing: ['listening', 'idle', 'error'],
  listening: ['transcribing', 'translating', 'muted', 'reconnecting', 'idle', 'error'],
  transcribing: ['translating', 'listening', 'muted', 'reconnecting', 'idle', 'error'],
  translating: ['listening', 'transcribing', 'muted', 'reconnecting', 'idle', 'error'],
  muted: ['listening', 'transcribing', 'translating', 'reconnecting', 'idle', 'error'],
  reconnecting: ['listening', 'transcribing', 'muted', 'idle', 'error'],
  error: ['idle', 'initializing', 'listening']
}

export function canTransitionState(
  from: SystemPipelineState,
  to: SystemPipelineState
): boolean {
  if (from === to) return true
  return ALLOWED_TRANSITIONS[from].includes(to)
}
