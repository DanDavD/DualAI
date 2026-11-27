/**
 * DUALAI - Zero-Trust Master Translation Orchestrator
 * Routes live translations strictly through the authenticated DualAI Cloud Gateway
 * (GatewayTranslationEngine), falling back to SimulatedTranslationEngine only when unsigned.
 * ZERO Gemini API keys or Google SDKs are ever present in the desktop renderer.
 */

import { ChannelId } from '../../../types/audio'
import { DomainId } from '../../../types/domain'
import {
  TranslationResult,
  TranslationToken,
  TranslationTelemetry,
  DialogueTurn
} from '../../../types/translation'
import { TranscriptUtterance } from '../../../types/stt'
import { GatewayTranslationEngine } from './GatewayTranslationEngine'
import { SimulatedTranslationEngine, TranslationCallbacks } from './SimulatedTranslationEngine'

export interface TranslationManagerCallbacks {
  onTranslationStart: (result: TranslationResult) => void
  onTranslationToken: (utteranceId: string, token: TranslationToken, accumulatedText: string) => void
  onTranslationComplete: (result: TranslationResult) => void
  onDraftStart?: (result: TranslationResult) => void
  onDraftToken?: (utteranceId: string, token: TranslationToken, accumulatedText: string) => void
  onDraftComplete?: (result: TranslationResult) => void
  onDraftError?: (utteranceId: string, error: Error) => void
  onTelemetry: (telemetry: TranslationTelemetry) => void
  onError: (error: Error) => void
  onQuotaExhausted?: (message: string) => void
}

export class TranslationManager {
  private callbacks: TranslationManagerCallbacks
  private gatewayEngine: GatewayTranslationEngine | null = null
  private simulatedEngine: SimulatedTranslationEngine
  private dialogueHistory: DialogueTurn[] = []
  private maxHistoryTurns: number = 20
  private customGlossary: Record<string, string> = {}

  constructor(
    callbacks: TranslationManagerCallbacks,
    options?: { accessToken?: string | null; customGlossary?: Record<string, string> }
  ) {
    this.callbacks = callbacks
    this.simulatedEngine = new SimulatedTranslationEngine()

    if (options?.customGlossary) {
      this.customGlossary = { ...options.customGlossary }
      this.simulatedEngine.setCustomGlossary(this.customGlossary)
    }

    if (options?.accessToken && options.accessToken.trim().length > 20) {
      this.gatewayEngine = new GatewayTranslationEngine(
        options.accessToken.trim(),
        this.customGlossary,
        callbacks.onQuotaExhausted
      )
    }
  }

  public setCustomGlossary(glossary: Record<string, string>): void {
    this.customGlossary = { ...glossary }
    this.gatewayEngine?.setCustomGlossary(this.customGlossary)
    this.simulatedEngine.setCustomGlossary(this.customGlossary)
  }

  public getCustomGlossary(): Record<string, string> {
    return { ...this.customGlossary }
  }

  public setAccessToken(token: string | null): void {
    const cleaned = token?.trim()
    if (cleaned && cleaned.length > 20) {
      if (this.gatewayEngine) {
        this.gatewayEngine.setAccessToken(cleaned)
      } else {
        this.gatewayEngine = new GatewayTranslationEngine(
          cleaned,
          this.customGlossary,
          this.callbacks.onQuotaExhausted
        )
      }
    } else {
      this.gatewayEngine?.cancelActiveStream()
      this.gatewayEngine = null
    }
  }

  /**
   * Streams a progressive live draft translation while the speaker is still talking.
   * Never cancels committed paragraphs and never mutates dialogueHistory until commit.
   */
  public async translateDraftPreview(
    utterance: TranscriptUtterance,
    domainId: DomainId,
    targetLang: string,
    operatingMode?: 'translate' | 'conversation',
    sourceLangOverride?: string
  ): Promise<void> {
    const draftCallbacks: TranslationCallbacks = {
      onStart: (result) => this.callbacks.onDraftStart?.(result),
      onToken: (token, accumulatedText) =>
        this.callbacks.onDraftToken?.(utterance.id, token, accumulatedText),
      onComplete: (result) => this.callbacks.onDraftComplete?.(result),
      onTelemetry: (telemetry) => this.callbacks.onTelemetry(telemetry),
      onError: (err) => {
        console.warn('[DUALAI] Background translation warning:', err.message)
        this.callbacks.onDraftError?.(utterance.id, err)
      }
    }

    if (this.gatewayEngine) {
      await this.gatewayEngine.translateStream(
        utterance,
        domainId,
        targetLang,
        this.dialogueHistory,
        draftCallbacks,
        { isDraft: true, operatingMode, sourceLangOverride }
      )
      return
    }

    await this.simulatedEngine.translateStream(utterance, domainId, targetLang, draftCallbacks)
  }

  /**
   * Translates a finalized committed paragraph without aborting any other committed paragraph.
   */
  public async translateUtterance(
    utterance: TranscriptUtterance,
    domainId: DomainId,
    targetLang: string,
    operatingMode?: 'translate' | 'conversation',
    sourceLangOverride?: string
  ): Promise<void> {
    const effectiveSourceLang = sourceLangOverride || utterance.language || 'en'
    const internalCallbacks: TranslationCallbacks = {
      onStart: (result) => this.callbacks.onTranslationStart(result),
      onToken: (token, accumulatedText) =>
        this.callbacks.onTranslationToken(utterance.id, token, accumulatedText),
      onComplete: (result) => {
        this.appendDialogueTurn({
          id: `turn-${utterance.id}`,
          channelId: utterance.channelId,
          speakerLabel: utterance.speakerLabel,
          sourceLang: effectiveSourceLang,
          targetLang,
          sourceText: utterance.text,
          translatedText: result.translatedText,
          domainId,
          timestampMs: Date.now()
        })
        this.callbacks.onTranslationComplete(result)
      },
      onTelemetry: (telemetry) => this.callbacks.onTelemetry(telemetry),
      onError: (err) => this.callbacks.onError(err)
    }

    if (this.gatewayEngine) {
      await this.gatewayEngine.translateStream(
        utterance,
        domainId,
        targetLang,
        this.dialogueHistory,
        internalCallbacks,
        { isDraft: false, operatingMode, sourceLangOverride: effectiveSourceLang }
      )
      return
    }

    await this.simulatedEngine.translateStream(
      utterance,
      domainId,
      targetLang,
      internalCallbacks
    )
  }

  public promoteDraftToFinal(channelId: ChannelId, utteranceId: string): boolean {
    return this.gatewayEngine?.promoteDraftToFinal(channelId, utteranceId) ?? false
  }

  public cancelDraftPreview(channelId?: ChannelId): void {
    this.gatewayEngine?.cancelDraftPreview(channelId)
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
    this.gatewayEngine?.cancelActiveStream()
    this.simulatedEngine.cancelActiveStream()
  }

  public isGatewayAuthenticated(): boolean {
    return Boolean(this.gatewayEngine)
  }
}
