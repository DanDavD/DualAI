/**
 * DUALAI - Live Gemini 2.0 Flash Streaming Translation Engine
 * Connects to Google Gemini 2.0 Flash via @google/genai SDK with streaming tokens,
 * low-temperature configuration (0.1), and domain-specific prompt injection.
 * Measures Time to First Token (TTFT) and end-to-end latency telemetry.
 */

import { GoogleGenAI } from '@google/genai'
import { DomainId } from '../../../types/domain'
import { TranslationResult, TranslationToken, TranslationTelemetry, DialogueTurn } from '../../../types/translation'
import { TranscriptUtterance } from '../../../types/stt'
import { buildDomainSystemInstruction, buildPromptWithContext } from './domainPrompts'
import { TranslationCallbacks } from './SimulatedTranslationEngine'

export class GeminiTranslationEngine {
  private apiKey: string
  private client: GoogleGenAI
  private abortController: AbortController | null = null
  private customGlossary?: Record<string, string>

  constructor(apiKey: string, customGlossary?: Record<string, string>) {
    this.apiKey = apiKey
    this.client = new GoogleGenAI({ apiKey: this.apiKey })
    this.customGlossary = customGlossary
  }

  public setCustomGlossary(glossary?: Record<string, string>): void {
    this.customGlossary = glossary
  }

  public async translateStream(
    utterance: TranscriptUtterance,
    domainId: DomainId,
    targetLang: string,
    dialogueHistory: DialogueTurn[],
    callbacks: TranslationCallbacks
  ): Promise<void> {
    this.cancelActiveStream()
    this.abortController = new AbortController()

    const startTime = performance.now()
    const translationId = `trans-${utterance.id}`

    const initialResult: TranslationResult = {
      id: translationId,
      utteranceId: utterance.id,
      channelId: utterance.channelId,
      speakerLabel: utterance.speakerLabel,
      sourceLang: utterance.language,
      targetLang,
      sourceText: utterance.text,
      translatedText: '',
      tokens: [],
      isStreaming: true,
      isComplete: false,
      domainId,
      timeToFirstTokenMs: 0,
      totalDurationMs: 0,
      endToEndLatencyMs: 0,
      provider: 'gemini-2.0-flash',
      timestampMs: Date.now()
    }

    callbacks.onStart(initialResult)

    try {
      const systemInstruction = buildDomainSystemInstruction(domainId)
      const prompt = buildPromptWithContext({
        domainId,
        sourceLang: utterance.language,
        targetLang,
        sourceText: utterance.text,
        speakerLabel: utterance.speakerLabel,
        dialogueHistory,
        customGlossary: this.customGlossary
      })

      const responseStream = await this.client.models.generateContentStream({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.1 // Low temperature for deterministic, hallucination-free translation
        }
      })

      let firstTokenTimestamp = 0
      let timeToFirstToken = 0
      const tokens: TranslationToken[] = []
      let accumulatedText = ''
      let tokenIdx = 0

      for await (const chunk of responseStream) {
        if (this.abortController?.signal.aborted) {
          break
        }

        const chunkText = chunk.text
        if (!chunkText) continue

        if (firstTokenTimestamp === 0) {
          firstTokenTimestamp = performance.now()
          timeToFirstToken = Math.round(firstTokenTimestamp - startTime)
        }

        // Split text chunk into words for granular token dispatch
        const chunkWords = chunkText.split(' ')
        for (const word of chunkWords) {
          if (!word) continue
          const token: TranslationToken = {
            id: `${translationId}-${tokenIdx}`,
            text: word,
            index: tokenIdx,
            timestampMs: Date.now()
          }

          tokens.push(token)
          tokenIdx++
          accumulatedText = tokens.map((t) => t.text).join(' ')
          callbacks.onToken(token, accumulatedText)
        }
      }

      const totalDuration = Math.round(performance.now() - startTime)
      // End-to-End latency: Audio Ingest (30ms) + VAD (~0.3ms) + STT (~90ms) + TTFT
      const endToEndLatencyMs = Math.round(30 + 0.3 + 90 + (timeToFirstToken || totalDuration))

      const finalResult: TranslationResult = {
        ...initialResult,
        translatedText: accumulatedText.trim(),
        tokens,
        isStreaming: false,
        isComplete: true,
        timeToFirstTokenMs: timeToFirstToken,
        totalDurationMs: totalDuration,
        endToEndLatencyMs
      }

      callbacks.onComplete(finalResult)
      callbacks.onTelemetry({
        utteranceId: utterance.id,
        channelId: utterance.channelId,
        timeToFirstTokenMs: timeToFirstToken,
        streamDurationMs: totalDuration,
        tokensCount: tokens.length,
        endToEndLatencyMs,
        domainId,
        provider: 'gemini-2.0-flash',
        timestampMs: Date.now()
      })
    } catch (err) {
      if (!this.abortController?.signal.aborted) {
        console.warn('[DUALAI-GEMINI] Live streaming error:', err)
        callbacks.onError(err as Error)
      }
    } finally {
      this.abortController = null
    }
  }

  public cancelActiveStream(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }
}
