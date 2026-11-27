/**
 * DUALAI - Zero-Trust Gateway Streaming Translation Engine (SSE)
 * Streams domain-specialized translations from the DualAI Cloud Gateway (/v1/translate)
 * authenticated solely via the user's Bearer JWT.
 * Zero Google GenAI SDK or Gemini API keys exist in the Electron renderer binary.
 */

import { ChannelId } from '../../../types/audio'
import { DomainId } from '../../../types/domain'
import {
  DialogueTurn,
  TranslationResult,
  TranslationToken
} from '../../../types/translation'
import { TranscriptUtterance } from '../../../types/stt'
import { TranslationCallbacks } from './SimulatedTranslationEngine'
import { getGatewayHttpUrl } from '../services/gatewayAuthService'

export interface TranslateStreamOptions {
  isDraft?: boolean
  operatingMode?: 'translate' | 'conversation'
  sourceLangOverride?: string
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'AbortError' || err.message.toLowerCase().includes('aborted')
}

export class GatewayTranslationEngine {
  private accessToken: string
  private finalControllers: Map<string, AbortController> = new Map()
  private draftControllers: Map<ChannelId, { utteranceId: string; controller: AbortController }> =
    new Map()
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
    callbacks: TranslationCallbacks,
    options?: TranslateStreamOptions
  ): Promise<void> {
    const isDraft = Boolean(options?.isDraft)
    const controller = new AbortController()

    if (isDraft) {
      // Live draft previews only cancel an earlier draft on the SAME channel
      this.cancelDraftPreview(utterance.channelId)
      this.draftControllers.set(utterance.channelId, {
        utteranceId: utterance.id,
        controller
      })
    } else {
      // Committed paragraphs NEVER cancel other committed paragraphs
      const existingSameId = this.finalControllers.get(utterance.id)
      if (existingSameId) {
        existingSameId.abort()
      }
      this.finalControllers.set(utterance.id, controller)
    }

    const startTime = performance.now()
    const translationId = isDraft ? `draft-${utterance.id}` : `trans-${utterance.id}`

    const effectiveSourceLang = options?.sourceLangOverride || utterance.language || 'en'
    const initialResult: TranslationResult = {
      id: translationId,
      utteranceId: utterance.id,
      channelId: utterance.channelId,
      speakerId: utterance.speakerId,
      speakerLabel: utterance.speakerLabel,
      sourceLang: effectiveSourceLang,
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
        signal: controller.signal,
        body: JSON.stringify({
          sourceText: utterance.text,
          sourceLang: effectiveSourceLang,
          targetLang,
          operatingMode: options?.operatingMode || 'translate',
          domainId,
          speakerLabel: utterance.speakerLabel,
          dialogueHistory: dialogueHistory.slice(-4).map((turn) => ({
            speakerLabel: turn.speakerLabel,
            sourceText: turn.sourceText,
            translatedText: turn.translatedText
          })),
          customGlossary: this.customGlossary
        })
      })

      if (controller.signal.aborted) {
        return
      }

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
        if (done || controller.signal.aborted) break

        sseBuffer += decoder.decode(value, { stream: true })
        const events = sseBuffer.split('\n\n')
        sseBuffer = events.pop() || ''

        for (const rawEvent of events) {
          if (controller.signal.aborted) break

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

      if (controller.signal.aborted) {
        return
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
      if (!controller.signal.aborted && !isAbortError(err)) {
        callbacks.onError(err as Error)
      }
    } finally {
      const activeDraft = this.draftControllers.get(utterance.channelId)
      if (activeDraft && activeDraft.controller === controller) {
        this.draftControllers.delete(utterance.channelId)
      }
      if (this.finalControllers.get(utterance.id) === controller) {
        this.finalControllers.delete(utterance.id)
      }
    }
  }

  /**
   * Moves an in-flight draft controller into finalControllers so subsequent drafts on the
   * same channel cannot abort it after the paragraph has committed.
   */
  public promoteDraftToFinal(channelId: ChannelId, utteranceId: string): boolean {
    const entry = this.draftControllers.get(channelId)
    if (!entry || entry.utteranceId !== utteranceId || entry.controller.signal.aborted) {
      return false
    }
    this.draftControllers.delete(channelId)
    const existingSameId = this.finalControllers.get(utteranceId)
    if (existingSameId && existingSameId !== entry.controller) {
      existingSameId.abort()
    }
    this.finalControllers.set(utteranceId, entry.controller)
    return true
  }

  public cancelDraftPreview(channelId?: ChannelId): void {
    if (channelId) {
      const entry = this.draftControllers.get(channelId)
      if (entry) {
        entry.controller.abort()
        this.draftControllers.delete(channelId)
      }
      return
    }
    for (const entry of this.draftControllers.values()) {
      entry.controller.abort()
    }
    this.draftControllers.clear()
  }

  public cancelActiveStream(): void {
    this.cancelDraftPreview()
    for (const ctrl of this.finalControllers.values()) {
      ctrl.abort()
    }
    this.finalControllers.clear()
  }
}
