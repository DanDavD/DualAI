/**
 * DUALAI - Master Translation Orchestrator
 * Coordinates real-time domain translation with Gemini 2.0 Flash and Simulated engine.
 * Maintains sliding dialogue history for cross-speaker bidirectional context memory.
 * Emits incremental token streams and end-to-end latency telemetry.
 */

import { DomainId } from '../../../types/domain'
import {
  TranslationResult,
  TranslationToken,
  TranslationTelemetry,
  DialogueTurn
} from '../../../types/translation'
import { TranscriptUtterance } from '../../../types/stt'
import { GeminiTranslationEngine } from './GeminiTranslationEngine'
import { SimulatedTranslationEngine, TranslationCallbacks } from './SimulatedTranslationEngine'

export interface TranslationManagerCallbacks {
  onTranslationStart: (result: TranslationResult) => void
  onTranslationToken: (token: TranslationToken, accumulatedText: string) => void
  onTranslationComplete: (result: TranslationResult) => void
  onTelemetry: (telemetry: TranslationTelemetry) => void
  onError: (error: Error) => void
}

export class TranslationManager {
  private callbacks: TranslationManagerCallbacks
  private apiKey?: string
  private geminiEngine: GeminiTranslationEngine | null = null
  private simulatedEngine: SimulatedTranslationEngine
  private dialogueHistory: DialogueTurn[] = []
  private maxHistoryTurns: number = 20

  constructor(callbacks: TranslationManagerCallbacks, options?: { apiKey?: string; customGlossary?: Record<string, string> }) {
    this.callbacks = callbacks
    this.apiKey = options?.apiKey || import.meta.env.VITE_GEMINI_API_KEY
    this.simulatedEngine = new SimulatedTranslationEngine()

    if (this.apiKey && this.apiKey.trim().length > 10 && this.apiKey !== 'your_gemini_api_key_here') {
      this.geminiEngine = new GeminiTranslationEngine(this.apiKey, options?.customGlossary)
    }
  }

  public setApiKey(key: string): void {
    this.apiKey = key
    if (key && key.trim().length > 10 && key !== 'your_gemini_api_key_here') {
      this.geminiEngine = new GeminiTranslationEngine(key)
    } else {
      this.geminiEngine = null
    }
  }

  public async translateUtterance(
    utterance: TranscriptUtterance,
    domainId: DomainId,
    targetLang: string
  ): Promise<void> {
    const internalCallbacks: TranslationCallbacks = {
      onStart: (result) => {
        this.callbacks.onTranslationStart(result)
      },
      onToken: (token, accumulatedText) => {
        this.callbacks.onTranslationToken(token, accumulatedText)
      },
      onComplete: (result) => {
        // Append turn to bidirectional dialogue history
        this.appendDialogueTurn({
          id: `turn-${utterance.id}`,
          channelId: utterance.channelId,
          speakerLabel: utterance.speakerLabel,
          sourceLang: utterance.language,
          targetLang,
          sourceText: utterance.text,
          translatedText: result.translatedText,
          domainId,
          timestampMs: Date.now()
        })
        this.callbacks.onTranslationComplete(result)
      },
      onTelemetry: (telemetry) => {
        this.callbacks.onTelemetry(telemetry)
      },
      onError: (err) => {
        this.callbacks.onError(err)
      }
    }

    if (this.geminiEngine) {
      try {
        await this.geminiEngine.translateStream(
          utterance,
          domainId,
          targetLang,
          this.dialogueHistory,
          internalCallbacks
        )
        return
      } catch (err) {
        console.warn('[DUALAI-TRANSLATION] Live Gemini stream failed, falling back to simulated domain engine:', err)
      }
    }

    // Default or fallback to high-fidelity simulated engine
    await this.simulatedEngine.translateStream(
      utterance,
      domainId,
      targetLang,
      internalCallbacks
    )
  }

  public appendDialogueTurn(turn: DialogueTurn): void {
    this.dialogueHistory.push(turn)
    if (this.dialogueHistory.length > this.maxHistoryTurns) {
      this.dialogueHistory.shift()
    }
  }

  public getDialogueHistory(): DialogueTurn[] {
    return [...this.dialogueHistory]
  }

  public clearHistory(): void {
    this.dialogueHistory = []
    this.cancelActive()
  }

  public cancelActive(): void {
    this.geminiEngine?.cancelActiveStream()
    this.simulatedEngine.cancelActiveStream()
  }

  public isLiveApiAvailable(): boolean {
    return Boolean(this.geminiEngine)
  }
}
