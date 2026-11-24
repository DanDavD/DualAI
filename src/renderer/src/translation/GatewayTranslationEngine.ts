/**
 * DUALAI - Zero-Trust Gateway Streaming Translation Engine (SSE)
 * Streams domain-specialized translations from the DualAI Cloud Gateway (/v1/translate)
 * authenticated solely via the user's Bearer JWT.
 * Zero Google GenAI SDK or Gemini API keys exist in the Electron renderer binary.
 */

import { DomainId } from '../../../types/domain'
import {
  DialogueTurn,
  TranslationResult,
  TranslationToken
} from '../../../types/translation'
import { TranscriptUtterance } from '../../../types/stt'
import { TranslationCallbacks } from './SimulatedTranslationEngine'
import { getGatewayHttpUrl } from '../services/gatewayAuthService'

export class GatewayTranslationEngine {
  private accessToken: string
  private abortController: AbortController | null = null
  private customGlossary?: Record<string, string>
  private onQuotaExhausted?: (message: string) => void

  constructor(
    accessToken: string,
    customGlossary?: Record<string, string>,
    onQuotaExhausted?: (message: string) => void
  ) {
    this.accessToken = accessToken
    this.customGlossary = customGlossary
    this.onQuotaExhausted = onQuotaExhausted
  }

  public setAccessToken(token: string): void {
    this.accessToken = token
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
      const response = await fetch(`${getGatewayHttpUrl()}/v1/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`
        },
        signal: this.abortController.signal,
        body: JSON.stringify({
          sourceText: utterance.text,
          sourceLang: utterance.language,
          targetLang,
          domainId,
          speakerLabel: utterance.speakerLabel,
          dialogueHistory: dialogueHistory.slice(-15).map((turn) => ({
            speakerLabel: turn.speakerLabel,
            sourceText: turn.sourceText,
            translatedText: turn.translatedText
          })),
          customGlossary: this.customGlossary
        })
      })

      if (response.status === 402) {
        const errData = (await response.json().catch(() => ({}))) as { message?: string }
        const msg = errData.message || 'Interpretation quota exhausted. Upgrade your plan.'
        this.onQuotaExhausted?.(msg)
        throw new Error(msg)
      }

      if (!response.ok || !response.body) {
        throw new Error(`Gateway translation failed (${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let sseBuffer = ''
      let firstTokenTimestamp = 0
      let timeToFirstToken = 0
      let accumulatedText = ''
      let tokenIdx = 0
      const streamTokens: TranslationToken[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done || this.abortController?.signal.aborted) break

        sseBuffer += decoder.decode(value, { stream: true })
        const events = sseBuffer.split('\n\n')
        sseBuffer = events.pop() || ''

        for (const rawEvent of events) {
          let eventType = 'message'
          let dataLine = ''

          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              dataLine += line.slice(5).trim()
            }
          }

          if (!dataLine) continue
          const parsed = JSON.parse(dataLine) as { text?: string; message?: string }

          if (eventType === 'error') {
            throw new Error(parsed.message || 'Gateway translation stream error')
          }

          if (eventType === 'token' && parsed.text) {
            if (firstTokenTimestamp === 0) {
              firstTokenTimestamp = performance.now()
              timeToFirstToken = Math.round(firstTokenTimestamp - startTime)
            }

            // Preserve exact raw token concatenation (zero mid-word space corruption)
            accumulatedText += parsed.text
            const token: TranslationToken = {
              id: `${translationId}-${tokenIdx}`,
              text: parsed.text,
              index: tokenIdx,
              timestampMs: Date.now()
            }
            streamTokens.push(token)
            tokenIdx++
            callbacks.onToken(token, accumulatedText)
          }
        }
      }

      const trimmedFinalText = accumulatedText.trim()
      const finalWordTokens: TranslationToken[] = trimmedFinalText
        ? trimmedFinalText.split(/\s+/).map((word, idx) => ({
            id: `${translationId}-word-${idx}`,
            text: word,
            index: idx,
            timestampMs: Date.now()
          }))
        : streamTokens

      const totalDuration = Math.round(performance.now() - startTime)
      const endToEndLatencyMs = Math.round(30 + 0.3 + 90 + (timeToFirstToken || totalDuration))

      const finalResult: TranslationResult = {
        ...initialResult,
        translatedText: trimmedFinalText,
        tokens: finalWordTokens,
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
        tokensCount: finalWordTokens.length,
        endToEndLatencyMs,
        domainId,
        provider: 'gemini-2.0-flash',
        timestampMs: Date.now()
      })
    } catch (err) {
      if (!this.abortController?.signal.aborted) {
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
