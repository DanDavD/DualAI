/**
 * DUALAI - Speaker-Aware 2.2-Second Pause Paragraph & Complete-Sentence Accumulator
 * Mirrors the exact turn-separation invariants used in SonioxStreamAssembler so Deepgram
 * produces identical, crisp paragraph grouping:
 * 1. Coalesces continuous speech from the SAME speaker across brief pauses (< 2.2s)
 *    so one speaker's thought stays in one cohesive paragraph.
 * 2. Splits cleanly after >= 2.2s of wall-clock OR acoustic timestamp pause (`pauseCommitMs`).
 * 3. Splits IMMEDIATELY (0ms wait) when a different diarized speaker interrupts, while
 *    never bleeding an interrupting speaker's unfinalized interim words into the active box.
 * 4. Splits nonstop single-speaker monologues cleanly at sentence punctuation (. ? !) once
 *    they reach `maxMonologueWords` (default 75 words) so text never piles up endlessly.
 * 5. Suppresses exact duplicate finalized clause replays (>= 12 chars).
 */

import { ChannelId } from '../../../types/audio'
import { TranscriptToken, TranscriptUtterance } from '../../../types/stt'

export const DEFAULT_PAUSE_COMMIT_MS = 2200
export const DEFAULT_MAX_MONOLOGUE_WORDS = 75
const SENTENCE_END_REGEX = /[.!?。？！]["”'»)]*$/
const DANGLING_FUNCTION_WORD_REGEX =
  /(?:^|\s)(?:la|el|los|las|un|una|unos|unas|de|del|al|en|con|por|para|que|y|o|ni|the|a|an|to|of|in|for|with|and|or|that)$/i

function endsWithDanglingFunctionWord(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || SENTENCE_END_REGEX.test(trimmed)) return false
  return DANGLING_FUNCTION_WORD_REGEX.test(trimmed)
}

export interface DraftUpdateMeta {
  isClauseFinalized: boolean
  isSpeechFinal?: boolean
}

export interface ParagraphAccumulatorCallbacks {
  onDraftUpdate: (draft: TranscriptUtterance, meta: DraftUpdateMeta) => void
  onParagraphCommit: (committed: TranscriptUtterance) => void
}

interface ChannelTurnBuffer {
  turnId: string
  channelId: ChannelId
  speakerId?: string
  speakerLabel: string
  language: string
  startedAtMs: number
  lastActivityMs: number
  lastWordEndMs: number
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

const RECENT_COMMIT_DEDUP_TTL_MS = 25000
const RECENT_INTERIM_DEDUP_TTL_MS = 8000
const MAX_RECENT_COMMITS_PER_CHANNEL = 3

interface RecentCommitRecord {
  normalized: string
  committedAtMs: number
}

function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strips any verbatim duplicate clause or overlapping prefix that already appeared in
 * `previousNormalized` (punctuation-insensitive, word-boundary safe).
 * Returns '' if the entire incoming segment is a duplicate replay.
 */
function stripDuplicateAgainstPrevious(
  rawText: string,
  previousNormalized: string,
  options?: { allowShortTailWithinMs?: boolean }
): string {
  const trimmed = rawText.trim()
  if (!trimmed || !previousNormalized) return trimmed

  const normIncoming = normalizeForDedup(trimmed)
  if (!normIncoming) return ''

  const incomingNormWords = normIncoming.split(' ').filter(Boolean)
  const paddedPrev = ` ${previousNormalized} `
  const paddedIncoming = ` ${normIncoming} `

  // 1. Full verbatim containment (>= 3 words, or >= 2 words matching exact tail immediately after commit)
  if (incomingNormWords.length >= 3 && paddedPrev.includes(paddedIncoming)) {
    return ''
  }
  if (
    options?.allowShortTailWithinMs &&
    incomingNormWords.length >= 2 &&
    paddedPrev.endsWith(paddedIncoming)
  ) {
    return ''
  }

  const rawTokens = trimmed.split(/\s+/).filter(Boolean)
  if (rawTokens.length < 3) return trimmed

  // 2. Suffix-prefix overlap: tail of previous text matches head of incoming text (>= 3 words)
  const maxPrefixCheck = Math.min(rawTokens.length, 60)
  for (let k = maxPrefixCheck; k >= 3; k--) {
    const prefixNorm = normalizeForDedup(rawTokens.slice(0, k).join(' '))
    if (!prefixNorm) continue
    const prefixWordCount = prefixNorm.split(' ').filter(Boolean).length
    if (prefixWordCount >= 3 && paddedPrev.endsWith(` ${prefixNorm} `)) {
      return rawTokens.slice(k).join(' ').trim()
    }
  }

  // 3. Long verbatim prefix (>= 5 words) already contained inside previous paragraph
  for (let k = maxPrefixCheck; k >= 5; k--) {
    const prefixNorm = normalizeForDedup(rawTokens.slice(0, k).join(' '))
    if (!prefixNorm) continue
    const prefixWordCount = prefixNorm.split(' ').filter(Boolean).length
    if (prefixWordCount >= 5 && paddedPrev.includes(` ${prefixNorm} `)) {
      return rawTokens.slice(k).join(' ').trim()
    }
  }

  return trimmed
}

function getWordTimingBounds(tokens: TranscriptToken[]): { firstStartMs: number; lastEndMs: number } {
  let firstStartMs = -1
  let lastEndMs = -1
  for (const tok of tokens) {
    // Preserve valid 0ms starting words while ignoring synthetic un-timed tokens (start=0, end=0)
    const hasTiming = tok.endTimeMs > 0 || tok.startTimeMs > 0
    if (!hasTiming) continue
    if (firstStartMs === -1 || tok.startTimeMs < firstStartMs) {
      firstStartMs = tok.startTimeMs
    }
    if (tok.endTimeMs > lastEndMs) {
      lastEndMs = tok.endTimeMs
    }
  }
  return { firstStartMs, lastEndMs }
}

export class ParagraphTurnAccumulator {
  private readonly pauseCommitMs: number
  private readonly maxMonologueWords: number
  private readonly callbacks: ParagraphAccumulatorCallbacks
  private readonly buffers: Partial<Record<ChannelId, ChannelTurnBuffer>> = {}
  private readonly recentCommits: Partial<Record<ChannelId, RecentCommitRecord[]>> = {}
  private turnSequence: number = 0

  constructor(
    callbacks: ParagraphAccumulatorCallbacks,
    pauseCommitMs: number = DEFAULT_PAUSE_COMMIT_MS,
    maxMonologueWords: number = DEFAULT_MAX_MONOLOGUE_WORDS
  ) {
    this.callbacks = callbacks
    this.pauseCommitMs = Math.max(200, pauseCommitMs)
    this.maxMonologueWords = Math.max(0, maxMonologueWords)
  }

  public getPauseCommitMs(): number {
    return this.pauseCommitMs
  }

  /**
   * Handles live interim words from STT while the speaker is actively speaking.
   * Prevents an interrupting speaker's unfinalized provisional words from visually
   * bleeding into the current finalized speaker's paragraph box.
   */
  public pushInterim(utterance: TranscriptUtterance): void {
    let cleanText = utterance.text.trim()
    if (!cleanText) return

    // Suppress stale interim replays and strip overlapping prefixes from recently committed paragraphs
    const nowMs = Date.now()
    const recentList = this.recentCommits[utterance.channelId]
    if (recentList && recentList.length > 0 && !this.buffers[utterance.channelId]) {
      for (let i = recentList.length - 1; i >= 0; i--) {
        const rec = recentList[i]
        const ageMs = nowMs - rec.committedAtMs
        if (ageMs > RECENT_INTERIM_DEDUP_TTL_MS) continue
        cleanText = stripDuplicateAgainstPrevious(cleanText, rec.normalized, {
          allowShortTailWithinMs: ageMs <= 3000
        })
        if (!cleanText) {
          return
        }
      }
    }

    const existing = this.buffers[utterance.channelId]
    if (existing && existing.finalizedSegments.length > 0) {
      const isDifferentProvisionalSpeaker =
        Boolean(utterance.speakerId) &&
        Boolean(existing.speakerId) &&
        utterance.speakerId !== existing.speakerId
      const incomingBaseLang = utterance.language?.trim().toLowerCase().split(/[-_]/)[0]
      const existingBaseLang = existing.language?.trim().toLowerCase().split(/[-_]/)[0]
      const isDifferentProvisionalLanguage =
        Boolean(incomingBaseLang) &&
        Boolean(existingBaseLang) &&
        incomingBaseLang !== existingBaseLang
      if (isDifferentProvisionalSpeaker || isDifferentProvisionalLanguage) {
        return
      }
    }

    const buf = this.ensureBuffer(utterance, false, -1)
    buf.currentInterimText = cleanText
    buf.currentInterimTokens = utterance.tokens
    buf.lastActivityMs = Date.now()

    this.resetCommitTimer(buf)
    this.callbacks.onDraftUpdate(this.buildSnapshot(buf, false), { isClauseFinalized: false })
  }

  /**
   * Handles an STT finalized clause (`is_final: true`).
   * - Splits immediately (0ms) on different speaker, different language, or >= 2.2s acoustic pause.
   * - Otherwise appends to the active paragraph and waits for a full 2.2s pause before committing.
   * - Splits nonstop monologues cleanly at sentence punctuation once >= maxMonologueWords (75).
   */
  public pushFinalSegment(utterance: TranscriptUtterance): void {
    let cleanText = utterance.text.trim()
    if (!cleanText) return

    // Cross-paragraph deduplication: block delayed STT finalized replays of text already committed
    const nowMs = Date.now()
    const recentList = this.recentCommits[utterance.channelId]
    if (recentList && recentList.length > 0) {
      for (let i = recentList.length - 1; i >= 0; i--) {
        const rec = recentList[i]
        const ageMs = nowMs - rec.committedAtMs
        if (ageMs > RECENT_COMMIT_DEDUP_TTL_MS) continue
        cleanText = stripDuplicateAgainstPrevious(cleanText, rec.normalized, {
          allowShortTailWithinMs: ageMs <= 3000
        })
        if (!cleanText) {
          return
        }
      }
    }

    const { firstStartMs, lastEndMs } = getWordTimingBounds(utterance.tokens)
    const buf = this.ensureBuffer(utterance, true, firstStartMs)

    // Intra-paragraph deduplication: strip exact or overlapping finalized replays within active turn
    const existingText = joinParagraphText(buf.finalizedSegments)
    const existingNorm = normalizeForDedup(existingText)
    const dedupedForActive = existingNorm
      ? stripDuplicateAgainstPrevious(cleanText, existingNorm, { allowShortTailWithinMs: true })
      : cleanText

    if (dedupedForActive) {
      buf.finalizedSegments.push(dedupedForActive)

      const tokenOffset = buf.finalizedTokens.length
      for (let i = 0; i < utterance.tokens.length; i++) {
        const tok = utterance.tokens[i]
        buf.finalizedTokens.push({
          ...tok,
          id: `${buf.turnId}-tok-${tokenOffset + i}`
        })
      }
    }

    if (lastEndMs >= 0 && (buf.lastWordEndMs < 0 || lastEndMs > buf.lastWordEndMs)) {
      buf.lastWordEndMs = lastEndMs
    }

    buf.currentInterimText = ''
    buf.currentInterimTokens = []
    buf.totalDurationMs += utterance.durationMs || 0
    if (utterance.averageConfidence > 0) {
      buf.confidenceSum += utterance.averageConfidence
      buf.confidenceCount += 1
    }
    buf.lastActivityMs = Date.now()

    const currentFullText = joinParagraphText(buf.finalizedSegments)
    const currentWordCount = currentFullText ? currentFullText.split(/\s+/).length : 0
    if (
      this.maxMonologueWords > 0 &&
      currentWordCount >= this.maxMonologueWords &&
      SENTENCE_END_REGEX.test(currentFullText)
    ) {
      this.commitChannel(utterance.channelId)
      return
    }

    const isDangling = endsWithDanglingFunctionWord(currentFullText)
    this.resetCommitTimer(buf, isDangling ? this.pauseCommitMs + 600 : this.pauseCommitMs)
    this.callbacks.onDraftUpdate(this.buildSnapshot(buf, false), {
      isClauseFinalized: true,
      // Do not trigger premature atomic translation when sentence ends mid-article ("entienda la")
      isSpeechFinal: Boolean(utterance.speechFinal) && !isDangling
    })
  }

  /**
   * Extends the silence commit timer when live audio/VAD confirms the speaker
   * is still talking, preventing mid-sentence splits during brief STT delays.
   */
  public notifySpeechActivity(channelId: ChannelId): void {
    const buf = this.buffers[channelId]
    if (!buf) return
    buf.lastActivityMs = Date.now()
    this.resetCommitTimer(buf)
  }

  /**
   * Immediately commits an open paragraph for a channel (e.g., on 2.2s pause, speaker interruption, or Stop).
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

    const normCommitted = normalizeForDedup(fullText)
    if (normCommitted) {
      const existingRecent = this.recentCommits[channelId] || []
      const nowMs = Date.now()
      const freshRecent = existingRecent.filter(
        (rec) => nowMs - rec.committedAtMs <= RECENT_COMMIT_DEDUP_TTL_MS
      )
      freshRecent.push({ normalized: normCommitted, committedAtMs: nowMs })
      this.recentCommits[channelId] = freshRecent.slice(-MAX_RECENT_COMMITS_PER_CHANNEL)
    }

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
      delete this.recentCommits[ch]
    }
  }

  public hasActiveTurn(channelId: ChannelId): boolean {
    return Boolean(this.buffers[channelId])
  }

  private ensureBuffer(
    utterance: TranscriptUtterance,
    isFinal: boolean = false,
    firstWordStartMs: number = -1
  ): ChannelTurnBuffer {
    const existing = this.buffers[utterance.channelId]
    if (existing) {
      const incomingBaseLang = utterance.language?.trim().toLowerCase().split(/[-_]/)[0]
      const existingBaseLang = existing.language?.trim().toLowerCase().split(/[-_]/)[0]
      const isDifferentSpeaker =
        Boolean(utterance.speakerId) &&
        Boolean(existing.speakerId) &&
        utterance.speakerId !== existing.speakerId
      const isDifferentLanguage =
        Boolean(incomingBaseLang) &&
        Boolean(existingBaseLang) &&
        incomingBaseLang !== existingBaseLang

      // Detect upstream WS hibernation/re-wake clock reset (timestamps jump backwards to ~0ms)
      const isClockReset =
        firstWordStartMs >= 0 &&
        existing.lastWordEndMs >= 0 &&
        firstWordStartMs + 500 < existing.lastWordEndMs

      const isLongAcousticPause = isClockReset
        ? Date.now() - existing.lastActivityMs >= this.pauseCommitMs
        : firstWordStartMs >= 0 &&
          existing.lastWordEndMs >= 0 &&
          firstWordStartMs - existing.lastWordEndMs >= this.pauseCommitMs

      if (
        isFinal &&
        existing.finalizedSegments.length > 0 &&
        (isDifferentSpeaker || isDifferentLanguage || isLongAcousticPause)
      ) {
        // Never freeze unstable provisional interim words into the closing speaker's row when
        // a finalized speaker/language switch arrives — prevents cross-row text overlap.
        existing.currentInterimText = ''
        existing.currentInterimTokens = []
        this.commitChannel(utterance.channelId)
      } else if (
        isFinal &&
        existing.finalizedSegments.length === 0 &&
        existing.currentInterimText.trim().length > 0 &&
        (isDifferentSpeaker || isDifferentLanguage)
      ) {
        // Speaker A only had provisional interim text when Speaker B interrupted in another
        // voice/language: commit Speaker A immediately if distinct so it is never lost and
        // Speaker B opens a fresh stack with a new turnId (never overwriting Speaker A).
        const normExistingInterim = normalizeForDedup(existing.currentInterimText)
        const normIncomingFinal = normalizeForDedup(utterance.text)
        const isSameUtteranceRevision =
          Boolean(normExistingInterim) &&
          Boolean(normIncomingFinal) &&
          (` ${normIncomingFinal} `.includes(` ${normExistingInterim} `) ||
            ` ${normExistingInterim} `.includes(` ${normIncomingFinal} `))
        if (!isSameUtteranceRevision) {
          this.commitChannel(utterance.channelId)
        } else {
          if (incomingBaseLang) existing.language = incomingBaseLang
          if (utterance.speakerId) {
            existing.speakerId = utterance.speakerId
            existing.speakerLabel = utterance.speakerLabel
          }
          return existing
        }
      } else {
        // Reset acoustic clock baseline cleanly after an upstream hibernation re-wake
        if (isClockReset) {
          existing.lastWordEndMs = -1
        }
        if (incomingBaseLang && (!existingBaseLang || existing.finalizedSegments.length === 0)) {
          existing.language = incomingBaseLang
        }
        if (utterance.speakerId && existing.finalizedSegments.length === 0) {
          existing.speakerId = utterance.speakerId
          existing.speakerLabel = utterance.speakerLabel
        }
        return existing
      }
    }

    this.turnSequence += 1
    const created: ChannelTurnBuffer = {
      turnId: `para-${utterance.channelId}-${Date.now()}-${this.turnSequence}`,
      channelId: utterance.channelId,
      speakerId: utterance.speakerId,
      speakerLabel: utterance.speakerLabel,
      language: utterance.language,
      startedAtMs: utterance.timestampMs || Date.now(),
      lastActivityMs: Date.now(),
      lastWordEndMs: -1,
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

  private resetCommitTimer(buf: ChannelTurnBuffer, delayMs: number = this.pauseCommitMs): void {
    if (buf.commitTimer) {
      clearTimeout(buf.commitTimer)
    }
    buf.commitTimer = setTimeout(() => {
      this.commitChannel(buf.channelId)
    }, delayMs)
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
      speakerId: buf.speakerId,
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
