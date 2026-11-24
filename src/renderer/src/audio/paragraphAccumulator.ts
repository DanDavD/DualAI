/**
 * DUALAI - 2-Second Pause Paragraph & Complete-Sentence Accumulator
 * Prevents short (~1s) speech pauses from fragmenting continuous speech into
 * separate UI blocks. Merges consecutive STT finalized clauses and live interim
 * text into a single coherent paragraph per channel until the speaker pauses
 * for `pauseCommitMs` (default: 2000ms), then fires the commit signal.
 */

import { ChannelId } from '../../../types/audio'
import { TranscriptToken, TranscriptUtterance } from '../../../types/stt'

export const DEFAULT_PAUSE_COMMIT_MS = 2000

export interface DraftUpdateMeta {
  isClauseFinalized: boolean
}

export interface ParagraphAccumulatorCallbacks {
  onDraftUpdate: (draft: TranscriptUtterance, meta: DraftUpdateMeta) => void
  onParagraphCommit: (committed: TranscriptUtterance) => void
}

interface ChannelTurnBuffer {
  turnId: string
  channelId: ChannelId
  speakerLabel: string
  language: string
  startedAtMs: number
  lastActivityMs: number
  totalDurationMs: number
  finalizedSegments: string[]
  finalizedTokens: TranscriptToken[]
  currentInterimText: string
  currentInterimTokens: TranscriptToken[]
  confidenceSum: number
  confidenceCount: number
  commitTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Joins accumulated finalized clauses and current live interim words cleanly
 * into a single readable paragraph string without duplicate spaces or space-before-punctuation.
 */
export function joinParagraphText(segments: string[], interimText?: string): string {
  const parts = [...segments]
  const cleanInterim = interimText?.trim()
  if (cleanInterim) {
    parts.push(cleanInterim)
  }

  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function normalizeTextForMatch(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

export class ParagraphTurnAccumulator {
  private readonly pauseCommitMs: number
  private readonly callbacks: ParagraphAccumulatorCallbacks
  private readonly buffers: Partial<Record<ChannelId, ChannelTurnBuffer>> = {}
  private turnSequence: number = 0

  constructor(callbacks: ParagraphAccumulatorCallbacks, pauseCommitMs: number = DEFAULT_PAUSE_COMMIT_MS) {
    this.callbacks = callbacks
    this.pauseCommitMs = Math.max(200, pauseCommitMs)
  }

  public getPauseCommitMs(): number {
    return this.pauseCommitMs
  }

  /**
   * Handles live interim words from STT while the speaker is actively speaking.
   */
  public pushInterim(utterance: TranscriptUtterance): void {
    const cleanText = utterance.text.trim()
    if (!cleanText) return

    const buf = this.ensureBuffer(utterance)
    buf.currentInterimText = cleanText
    buf.currentInterimTokens = utterance.tokens
    buf.lastActivityMs = Date.now()

    this.resetCommitTimer(buf)
    this.callbacks.onDraftUpdate(this.buildSnapshot(buf, false), { isClauseFinalized: false })
  }

  /**
   * Handles an STT finalized clause (`is_final: true`).
   * Instead of splitting immediately on a short ~0.3s-1s pause, appends the clause
   * into the active paragraph buffer and waits for a full 2-second pause before committing.
   */
  public pushFinalSegment(utterance: TranscriptUtterance): void {
    const cleanText = utterance.text.trim()
    if (!cleanText) return

    const buf = this.ensureBuffer(utterance)
    buf.finalizedSegments.push(cleanText)

    const tokenOffset = buf.finalizedTokens.length
    for (let i = 0; i < utterance.tokens.length; i++) {
      const tok = utterance.tokens[i]
      buf.finalizedTokens.push({
        ...tok,
        id: `${buf.turnId}-tok-${tokenOffset + i}`
      })
    }

    buf.currentInterimText = ''
    buf.currentInterimTokens = []
    buf.totalDurationMs += utterance.durationMs || 0
    if (utterance.averageConfidence > 0) {
      buf.confidenceSum += utterance.averageConfidence
      buf.confidenceCount += 1
    }
    buf.lastActivityMs = Date.now()

    this.resetCommitTimer(buf)
    this.callbacks.onDraftUpdate(this.buildSnapshot(buf, false), { isClauseFinalized: true })
  }

  /**
   * Extends the 2-second silence timer when live audio/VAD confirms the speaker
   * is still talking, preventing mid-sentence splits during brief STT delays.
   */
  public notifySpeechActivity(channelId: ChannelId): void {
    const buf = this.buffers[channelId]
    if (!buf) return
    buf.lastActivityMs = Date.now()
    this.resetCommitTimer(buf)
  }

  /**
   * Immediately commits an open paragraph for a channel (e.g., on 2-second pause or Stop).
   */
  public commitChannel(channelId: ChannelId): TranscriptUtterance | null {
    const buf = this.buffers[channelId]
    if (!buf) return null

    if (buf.commitTimer) {
      clearTimeout(buf.commitTimer)
      buf.commitTimer = null
    }
    delete this.buffers[channelId]

    const fullText = joinParagraphText(buf.finalizedSegments, buf.currentInterimText)
    if (!fullText) return null

    const committed = this.buildSnapshot(buf, true)
    this.callbacks.onParagraphCommit(committed)
    return committed
  }

  /**
   * Commits any pending paragraphs across all channels cleanly (e.g. when stopping translation).
   */
  public flushAll(): void {
    const channels: ChannelId[] = ['channel_a', 'channel_b']
    for (const ch of channels) {
      if (this.buffers[ch]) {
        this.commitChannel(ch)
      }
    }
  }

  /**
   * Discards all pending buffers and clears all timers cleanly (zero memory/timer leaks).
   */
  public reset(): void {
    const channels: ChannelId[] = ['channel_a', 'channel_b']
    for (const ch of channels) {
      const buf = this.buffers[ch]
      if (buf?.commitTimer) {
        clearTimeout(buf.commitTimer)
      }
      delete this.buffers[ch]
    }
  }

  public hasActiveTurn(channelId: ChannelId): boolean {
    return Boolean(this.buffers[channelId])
  }

  private ensureBuffer(utterance: TranscriptUtterance): ChannelTurnBuffer {
    const existing = this.buffers[utterance.channelId]
    if (existing) {
      if (utterance.language) {
        existing.language = utterance.language
      }
      return existing
    }

    this.turnSequence += 1
    const created: ChannelTurnBuffer = {
      turnId: `para-${utterance.channelId}-${Date.now()}-${this.turnSequence}`,
      channelId: utterance.channelId,
      speakerLabel: utterance.speakerLabel,
      language: utterance.language,
      startedAtMs: utterance.timestampMs || Date.now(),
      lastActivityMs: Date.now(),
      totalDurationMs: 0,
      finalizedSegments: [],
      finalizedTokens: [],
      currentInterimText: '',
      currentInterimTokens: [],
      confidenceSum: 0,
      confidenceCount: 0,
      commitTimer: null
    }
    this.buffers[utterance.channelId] = created
    return created
  }

  private resetCommitTimer(buf: ChannelTurnBuffer): void {
    if (buf.commitTimer) {
      clearTimeout(buf.commitTimer)
    }
    buf.commitTimer = setTimeout(() => {
      this.commitChannel(buf.channelId)
    }, this.pauseCommitMs)
  }

  private buildSnapshot(buf: ChannelTurnBuffer, isFinal: boolean): TranscriptUtterance {
    const fullText = joinParagraphText(buf.finalizedSegments, buf.currentInterimText)
    const combinedTokens: TranscriptToken[] = [
      ...buf.finalizedTokens,
      ...buf.currentInterimTokens.map((tok, idx) => ({
        ...tok,
        id: `${buf.turnId}-int-${buf.finalizedTokens.length + idx}`
      }))
    ]
    const avgConfidence =
      buf.confidenceCount > 0
        ? Math.round((buf.confidenceSum / buf.confidenceCount) * 100) / 100
        : 0.92

    return {
      id: buf.turnId,
      channelId: buf.channelId,
      speakerLabel: buf.speakerLabel,
      language: buf.language,
      text: fullText,
      tokens: combinedTokens,
      isFinal,
      timestampMs: buf.startedAtMs,
      durationMs: Math.max(buf.totalDurationMs, Date.now() - buf.startedAtMs),
      averageConfidence: avgConfidence,
      receivedAtMs: Date.now()
    }
  }
}
