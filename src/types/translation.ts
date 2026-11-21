/**
 * DUALAI - Real-Time Domain Inference & Translation Type Definitions
 * Strict TypeScript models for streaming Gemini 2.0 Flash inference,
 * domain prompt directives (ICD-10, Verbatim Legal), bidirectional context memory,
 * and end-to-end latency telemetry.
 */

import { ChannelId } from './audio'
import { DomainId } from './domain'

export interface TranslationToken {
  id: string
  text: string
  index: number
  timestampMs: number
}

export interface TranslationResult {
  id: string
  utteranceId: string
  channelId: ChannelId
  speakerLabel: string
  sourceLang: string
  targetLang: string
  sourceText: string
  translatedText: string
  tokens: TranslationToken[]
  isStreaming: boolean
  isComplete: boolean
  domainId: DomainId
  timeToFirstTokenMs: number
  totalDurationMs: number
  endToEndLatencyMs: number
  provider: 'gemini-2.0-flash' | 'simulated-gemini'
  timestampMs: number
}

export interface DialogueTurn {
  id: string
  channelId: ChannelId
  speakerLabel: string
  sourceLang: string
  targetLang: string
  sourceText: string
  translatedText: string
  domainId: DomainId
  timestampMs: number
}

export interface TranslationTelemetry {
  utteranceId: string
  channelId: ChannelId
  timeToFirstTokenMs: number // Must be < 400ms from speech pause
  streamDurationMs: number
  tokensCount: number
  endToEndLatencyMs: number // Audio Ingest (30ms) + VAD (~0.3ms) + STT (~90ms) + Translation TTFT
  domainId: DomainId
  provider: 'gemini-2.0-flash' | 'simulated-gemini'
  timestampMs: number
}

export interface DomainPromptConfig {
  domainId: DomainId
  sourceLang: string
  targetLang: string
  temperature: number // 0.1 for deterministic translation
  dialogueHistory: DialogueTurn[]
  customGlossaryTerms?: Record<string, string>
}
