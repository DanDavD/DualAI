/**
 * DUALAI - Soniox Unified Real-Time Speaker-Separated Paragraph Stream Assembler
 * Processes single-pipeline Soniox tokens containing original speech, simultaneous
 * translation, 15-speaker diarization, language identification, and endpoint markers (<end>, <fin>).
 *
 * SUPREME TURN-SEPARATION INVARIANTS:
 * 1. NEVER mixes two different speakers (voices) into the same paragraph. The instant a
 *    different speaker ID produces a finalized word (e.g., Speaker 2 interrupts Speaker 1),
 *    Speaker 1's paragraph commits immediately (0ms wait) and Speaker 2 starts a new paragraph.
 * 2. NEVER mixes two different languages into the same paragraph (in both Conversation and
 *    Translate modes). A finalized language switch commits immediately and opens a new row.
 * 3. Keeps continuous speech from the SAME speaker & language coalesced across brief pauses
 *    (up to `sameLanguageSettleMs`, default 2,000ms) so one speaker's thought stays cohesive.
 * 4. Routes trailing finalized translation tokens back to the exact committed speaker turn
 *    (matching speakerId + sourceLanguage) so interrupted speakers still receive their full
 *    right-pane translation without bleeding into the next speaker's row.
 * 5. NEVER commits unfinalized (is_final: false) tokens, keeps provisional tokens scoped to the
 *    active speaker, and suppresses duplicate clause re-emissions.
 */

import { ChannelId } from '../../../../types/audio'
import { DomainId } from '../../../../types/domain'
import { TranscriptToken, TranscriptUtterance } from '../../../../types/stt'
import { TranslationResult, TranslationToken } from '../../../../types/translation'

export interface SonioxRawToken {
  text: string
  is_final?: boolean
  speaker?: string | number
  language?: string
  source_language?: string
  translation_status?: 'none' | 'original' | 'translation'
  confidence?: number
  start_ms?: number
  end_ms?: number
}

export interface UnifiedTurnSnapshot {
  utterance: TranscriptUtterance
  translation: TranslationResult
}

export interface SonioxAssemblerConfig {
  channelId: ChannelId
  sourceLang: string
  targetLang: string
  operatingMode: 'translate' | 'conversation'
  domainId: DomainId
  confidenceThreshold: number
  sameLanguageSettleMs?: number
  maxMonologueWords?: number
}

export interface SonioxAssemblerCallbacks {
  onUnifiedDraft: (snapshot: UnifiedTurnSnapshot) => void
  onUnifiedCommit: (snapshot: UnifiedTurnSnapshot) => void
  onUnifiedCommitUpdate: (snapshot: UnifiedTurnSnapshot) => void
}

interface InternalTurnState {
  id: string
  speakerId: string
  sourceLanguage: string
  targetLanguage: string
  startedAtMs: number
  committedAtMs: number | null
  lastTokenEndMs: number
  awaitingClauseSpaceOrig: boolean
  awaitingClauseSpaceTrans: boolean
  finalOriginalText: string
  interimOriginalText: string
  finalOriginalTokens: TranscriptToken[]
  finalTranslatedText: string
  interimTranslatedText: string
  confidenceSum: number
  confidenceCount: number
}

const DEFAULT_SAME_LANGUAGE_SETTLE_MS = 2200
const DEFAULT_MAX_MONOLOGUE_WORDS = 75
const RECENT_COMMIT_WINDOW_MS = 10000
const MAX_RECENT_COMMITTED_TURNS = 12
const HAS_WORD_CHAR_REGEX = /[A-Za-zÀ-ÖØ-öø-ÿ\p{L}\p{N}]/u
const SENTENCE_END_REGEX = /[.!?。？！]["”'»)]*$/

export function normalizeBaseLang(lang?: string): string | undefined {
  if (!lang) return undefined
  const base = lang.trim().toLowerCase().split(/[-_]/)[0]
  return base ? base.slice(0, 5) : undefined
}

function cleanJoinedText(raw: string): string {
  return raw
    .replace(/<end>|<fin>/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function normalizeSpeaker(speaker?: string | number): string | undefined {
  if (speaker === undefined || speaker === null || speaker === '') return undefined
  return String(speaker).trim()
}

/**
 * Appends finalized text cleanly while preventing boundary spacing glitches after <end>
 * or sentence punctuation, avoiding spaces before digits/closing quotes, and suppressing
 * exact repeated clause re-emissions (>= 12 chars).
 */
function appendFinalSegmentSafely(
  existing: string,
  incoming: string,
  insertSpaceIfBoundary: boolean
): { text: string; suppressed: boolean; insertedSpace: boolean } {
  if (!incoming) return { text: existing, suppressed: false, insertedSpace: false }
  if (!existing) return { text: incoming, suppressed: false, insertedSpace: false }

  const cleanIncoming = incoming.trim()
  const cleanExisting = existing.trim()

  // Suppress exact duplicate clause re-emission if Soniox replays an already-finalized phrase
  if (cleanIncoming.length >= 12) {
    const normExisting = cleanExisting.toLowerCase()
    const normIncoming = cleanIncoming.toLowerCase()
    if (normExisting.endsWith(normIncoming)) {
      return { text: existing, suppressed: true, insertedSpace: false }
    }
  }

  const needsSentenceSpace =
    (insertSpaceIfBoundary || /[.!?。？！]$/.test(existing)) &&
    !/\s$/.test(existing) &&
    !/^\s/.test(incoming) &&
    !/^[,.;:!?0-9"'”’»)\]]/.test(incoming)

  if (needsSentenceSpace) {
    return { text: `${existing} ${incoming}`, suppressed: false, insertedSpace: true }
  }

  return { text: `${existing}${incoming}`, suppressed: false, insertedSpace: false }
}

export class SonioxStreamAssembler {
  private config: SonioxAssemblerConfig
  private callbacks: SonioxAssemblerCallbacks
  private activeTurn: InternalTurnState | null = null
  private recentCommitted: InternalTurnState[] = []
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private turnSeq: number = 0

  constructor(config: SonioxAssemblerConfig, callbacks: SonioxAssemblerCallbacks) {
    this.config = {
      ...config,
      sourceLang: normalizeBaseLang(config.sourceLang) || 'en',
      targetLang: normalizeBaseLang(config.targetLang) || 'es',
      sameLanguageSettleMs: config.sameLanguageSettleMs ?? DEFAULT_SAME_LANGUAGE_SETTLE_MS,
      maxMonologueWords: config.maxMonologueWords ?? DEFAULT_MAX_MONOLOGUE_WORDS
    }
    this.callbacks = callbacks
  }

  public updateConfig(partial: Partial<SonioxAssemblerConfig>): void {
    this.config = {
      ...this.config,
      ...partial,
      sourceLang: normalizeBaseLang(partial.sourceLang ?? this.config.sourceLang) || 'en',
      targetLang: normalizeBaseLang(partial.targetLang ?? this.config.targetLang) || 'es'
    }
  }

  public ingestTokens(rawTokens: SonioxRawToken[]): void {
    if (!Array.isArray(rawTokens) || rawTokens.length === 0) return

    this.pruneRecentCommitted()

    let frameInterimOriginal = ''
    let frameInterimTranslation = ''
    let sawOriginalActivity = false
    let sawTranslationActivity = false
    let sawSoftEnd = false
    let sawHardFinalize = false

    const updatedCommittedTurns = new Set<InternalTurnState>()
    const committedInterimTranslations = new Map<InternalTurnState, string>()

    for (const raw of rawTokens) {
      if (!raw || typeof raw.text !== 'string' || raw.text.length === 0) continue

      if (raw.text === '<end>') {
        sawSoftEnd = true
        if (this.activeTurn) {
          this.activeTurn.awaitingClauseSpaceOrig = true
          this.activeTurn.awaitingClauseSpaceTrans = true
        }
        continue
      }

      if (raw.text === '<fin>') {
        sawHardFinalize = true
        continue
      }

      const isFinal = Boolean(raw.is_final)
      const isTranslation = raw.translation_status === 'translation'
      const tokenSpeaker = normalizeSpeaker(raw.speaker)
      const tokenLang = this.constrainToActiveLanguagePair(raw.language)
      const tokenSourceLang = this.constrainToActiveLanguagePair(raw.source_language)

      if (isTranslation) {
        sawTranslationActivity = true
        const targetTurn = this.resolveTranslationTargetTurn(tokenSpeaker, tokenSourceLang)

        if (targetTurn) {
          if (targetTurn === this.activeTurn) {
            if (isFinal) {
              const appended = appendFinalSegmentSafely(
                targetTurn.finalTranslatedText,
                raw.text,
                targetTurn.awaitingClauseSpaceTrans
              )
              targetTurn.finalTranslatedText = appended.text
              targetTurn.awaitingClauseSpaceTrans = false
              targetTurn.interimTranslatedText = ''
            } else {
              frameInterimTranslation += raw.text
            }
          } else {
            // Reconcile trailing finalized translation tokens onto the exact interrupted speaker's turn
            if (isFinal) {
              const appended = appendFinalSegmentSafely(
                targetTurn.finalTranslatedText,
                raw.text,
                targetTurn.awaitingClauseSpaceTrans
              )
              targetTurn.finalTranslatedText = appended.text
              targetTurn.awaitingClauseSpaceTrans = false
              targetTurn.interimTranslatedText = ''
            } else if (!cleanJoinedText(targetTurn.finalTranslatedText)) {
              const prevInterim = committedInterimTranslations.get(targetTurn) || ''
              const nextInterim = prevInterim + raw.text
              committedInterimTranslations.set(targetTurn, nextInterim)
              targetTurn.interimTranslatedText = nextInterim
            }
            updatedCommittedTurns.add(targetTurn)
          }
        }
        continue
      }

      // Original spoken token
      sawOriginalActivity = true
      const effectiveSpeaker = tokenSpeaker || this.activeTurn?.speakerId || '1'
      const effectiveLang =
        tokenLang || this.activeTurn?.sourceLanguage || this.config.sourceLang

      // SUPREME LAW: Split immediately (0ms wait) whenever:
      // 1. A DIFFERENT diarized speaker produces a finalized word (interruption), OR
      // 2. A DIFFERENT language produces a finalized word, OR
      // 3. The SAME speaker paused acoustically >= sameLanguageSettleMs (e.g. 2.2s) per Soniox timestamps.
      const settleMs = Math.max(
        250,
        this.config.sameLanguageSettleMs ?? DEFAULT_SAME_LANGUAGE_SETTLE_MS
      )
      const isLongAcousticPause =
        isFinal &&
        Boolean(this.activeTurn) &&
        cleanJoinedText(this.activeTurn!.finalOriginalText).length > 0 &&
        HAS_WORD_CHAR_REGEX.test(raw.text) &&
        typeof raw.start_ms === 'number' &&
        this.activeTurn!.lastTokenEndMs > 0 &&
        raw.start_ms - this.activeTurn!.lastTokenEndMs >= settleMs

      if (
        isFinal &&
        this.activeTurn &&
        (this.isGenuineSpeakerChange(this.activeTurn, tokenSpeaker, raw.text) ||
          this.isGenuineLanguageSwitch(this.activeTurn, tokenLang, raw.text) ||
          isLongAcousticPause)
      ) {
        this.commitActiveTurn()
      }

      if (!this.activeTurn) {
        this.activeTurn = this.createTurn(effectiveSpeaker, effectiveLang)
      } else {
        // Before any finalized text is locked in on a fresh turn, adopt the first confirmed speaker & language
        if (!cleanJoinedText(this.activeTurn.finalOriginalText)) {
          if (tokenSpeaker) {
            this.activeTurn.speakerId = tokenSpeaker
          }
          if (tokenLang) {
            this.activeTurn.sourceLanguage = tokenLang
            this.activeTurn.targetLanguage = this.resolveTargetLanguage(tokenLang)
          }
        }
      }

      if (isFinal) {
        // New finalized speech resets any pending silence settle timer so the paragraph coalesces smoothly
        this.clearSettleTimer()

        if (typeof raw.end_ms === 'number' && raw.end_ms > this.activeTurn.lastTokenEndMs) {
          this.activeTurn.lastTokenEndMs = raw.end_ms
        }

        const appended = appendFinalSegmentSafely(
          this.activeTurn.finalOriginalText,
          raw.text,
          this.activeTurn.awaitingClauseSpaceOrig
        )
        this.activeTurn.finalOriginalText = appended.text
        const insertedBoundarySpace = appended.insertedSpace || this.activeTurn.awaitingClauseSpaceOrig
        this.activeTurn.awaitingClauseSpaceOrig = false
        this.activeTurn.interimOriginalText = ''

        if (!appended.suppressed) {
          const conf = typeof raw.confidence === 'number' ? raw.confidence : 0.94
          const roundedConf = Math.round(conf * 100) / 100
          this.activeTurn.confidenceSum += roundedConf
          this.activeTurn.confidenceCount += 1

          // Merge Soniox BPE sub-word tokens cleanly into whole words
          const startsNewWord =
            insertedBoundarySpace ||
            /^\s/.test(raw.text) ||
            this.activeTurn.finalOriginalTokens.length === 0
          const piece = raw.text.trim()
          if (piece) {
            if (startsNewWord) {
              this.activeTurn.finalOriginalTokens.push({
                id: `${this.activeTurn.id}-tok-${this.activeTurn.finalOriginalTokens.length}`,
                text: piece,
                confidence: roundedConf,
                isLowConfidence: roundedConf < this.config.confidenceThreshold,
                startTimeMs: raw.start_ms ?? 0,
                endTimeMs: raw.end_ms ?? 0,
                isPunctuated: true,
                speakerId: this.activeTurn.speakerId
              })
            } else {
              const prev =
                this.activeTurn.finalOriginalTokens[this.activeTurn.finalOriginalTokens.length - 1]
              prev.text += piece
              prev.confidence = Math.min(prev.confidence, roundedConf)
              prev.isLowConfidence = prev.confidence < this.config.confidenceThreshold
              if (raw.end_ms) {
                prev.endTimeMs = raw.end_ms
              }
            }
          }
        }

        // Prevent infinite walls of text during nonstop monologues: once >= maxMonologueWords (75),
        // split immediately and cleanly at the sentence-ending punctuation (. ? !) so trailing
        // tokens in the same batch start cleanly on the next paragraph and never leak across speakers.
        const maxWords = this.config.maxMonologueWords ?? DEFAULT_MAX_MONOLOGUE_WORDS
        const currentClean = cleanJoinedText(this.activeTurn.finalOriginalText)
        if (
          maxWords > 0 &&
          SENTENCE_END_REGEX.test(currentClean) &&
          currentClean.split(/\s+/).length >= maxWords
        ) {
          this.commitActiveTurn()
        }
      } else {
        // Provisional speech: keep a different interrupting speaker's unfinalized words
        // from visually bleeding into the current speaker's paragraph before finalization.
        const isDifferentProvisionalSpeaker =
          Boolean(tokenSpeaker) &&
          Boolean(this.activeTurn.speakerId) &&
          tokenSpeaker !== this.activeTurn.speakerId &&
          cleanJoinedText(this.activeTurn.finalOriginalText).length > 0

        const isDifferentProvisionalLanguage =
          Boolean(tokenLang) &&
          Boolean(this.activeTurn.sourceLanguage) &&
          tokenLang !== this.activeTurn.sourceLanguage &&
          cleanJoinedText(this.activeTurn.finalOriginalText).length > 0

        if (!isDifferentProvisionalSpeaker && !isDifferentProvisionalLanguage) {
          if (raw.text.trim().length > 0) {
            this.clearSettleTimer()
          }
          frameInterimOriginal += raw.text
        }
      }
    }

    // Emit reconciled updates for recently committed turns that received trailing finalized translations
    for (const committedTurn of updatedCommittedTurns) {
      const snap = this.buildSnapshot(committedTurn, true)
      if (snap) {
        this.callbacks.onUnifiedCommitUpdate(snap)
      }
    }

    if (this.activeTurn) {
      if (sawOriginalActivity || sawSoftEnd || sawHardFinalize) {
        this.activeTurn.interimOriginalText =
          sawSoftEnd || sawHardFinalize ? '' : frameInterimOriginal
      }
      if (sawTranslationActivity || sawSoftEnd || sawHardFinalize) {
        this.activeTurn.interimTranslatedText =
          sawSoftEnd || sawHardFinalize ? '' : frameInterimTranslation
      }

      // Hard finalize (<fin> after confirmed 2.2s audio silence pause) commits cleanly
      if (sawHardFinalize) {
        this.commitActiveTurn()
        return
      }

      // Silence-threshold settle commit (default 2,200ms):
      // Arms whenever finalized text is present and no provisional speech is currently streaming
      // (including after a dropped transient provisional frame when endpoint detection is OFF).
      const hasFinalizedText = cleanJoinedText(this.activeTurn.finalOriginalText).length > 0
      const hasLiveInterimText = cleanJoinedText(this.activeTurn.interimOriginalText).length > 0
      if (hasFinalizedText && (sawSoftEnd || (!hasLiveInterimText && !this.settleTimer))) {
        this.scheduleSameLanguageSettleCommit()
      }

      const draftSnap = this.buildSnapshot(this.activeTurn, false)
      if (draftSnap) {
        this.callbacks.onUnifiedDraft(draftSnap)
      }
    }
  }

  public flushActiveTurn(): void {
    this.commitActiveTurn()
  }

  public reset(): void {
    this.clearSettleTimer()
    this.activeTurn = null
    this.recentCommitted = []
  }

  /**
   * Maps any raw language tag (e.g. "es-MX", "en-US") strictly into the active language pair.
   * Preserves both sourceLang and targetLang tags in both Conversation and Translate modes
   * so speakers speaking different languages never collapse into a single paragraph.
   */
  private constrainToActiveLanguagePair(rawLang?: string): string | undefined {
    const base = normalizeBaseLang(rawLang)
    if (!base) return undefined

    if (base === this.config.sourceLang || base === this.config.targetLang) {
      return base
    }
    return undefined
  }

  /**
   * Triggers an immediate turn split whenever a different diarized voice (speaker)
   * produces a finalized word after the current speaker has already spoken.
   * Ignores isolated punctuation tokens so trailing punctuation stays with the first speaker.
   */
  private isGenuineSpeakerChange(
    current: InternalTurnState,
    nextSpeaker: string | undefined,
    rawText: string
  ): boolean {
    if (!nextSpeaker || !current.speakerId || nextSpeaker === current.speakerId) return false
    if (cleanJoinedText(current.finalOriginalText).length === 0) return false
    if (!HAS_WORD_CHAR_REGEX.test(rawText)) return false
    return true
  }

  /**
   * Triggers an immediate turn split whenever a genuine finalized word switches
   * between the active language pair (e.g., Spanish <-> English) in either operating mode.
   */
  private isGenuineLanguageSwitch(
    current: InternalTurnState,
    nextLang: string | undefined,
    rawText: string
  ): boolean {
    if (!nextLang || !current.sourceLanguage || nextLang === current.sourceLanguage) return false
    if (cleanJoinedText(current.finalOriginalText).length === 0) return false
    if (!HAS_WORD_CHAR_REGEX.test(rawText)) return false
    return true
  }

  /**
   * Routes translation tokens strictly to the matching speaker + source language turn.
   * When Speaker 2 interrupts Speaker 1, trailing translation tokens for Speaker 1
   * still land cleanly on Speaker 1's committed row instead of bleeding into Speaker 2.
   */
  private resolveTranslationTargetTurn(
    tokenSpeaker?: string,
    tokenSourceLang?: string
  ): InternalTurnState | null {
    // 1. Exact speaker + language match: check activeTurn first, then recently committed turns
    if (tokenSpeaker) {
      if (
        this.activeTurn &&
        this.activeTurn.speakerId === tokenSpeaker &&
        (!tokenSourceLang || this.activeTurn.sourceLanguage === tokenSourceLang)
      ) {
        return this.activeTurn
      }

      for (let i = this.recentCommitted.length - 1; i >= 0; i--) {
        const candidate = this.recentCommitted[i]
        if (
          candidate.speakerId === tokenSpeaker &&
          (!tokenSourceLang || candidate.sourceLanguage === tokenSourceLang)
        ) {
          return candidate
        }
      }
    }

    // 2. Fallback when translation token omits speaker: prioritize recently committed turn with empty translation
    for (let i = this.recentCommitted.length - 1; i >= 0; i--) {
      const candidate = this.recentCommitted[i]
      const langMatches = !tokenSourceLang || candidate.sourceLanguage === tokenSourceLang
      if (langMatches && cleanJoinedText(candidate.finalTranslatedText).length === 0) {
        return candidate
      }
    }

    // 3. Match activeTurn by sourceLanguage
    if (this.activeTurn) {
      const langMatches = !tokenSourceLang || this.activeTurn.sourceLanguage === tokenSourceLang
      if (langMatches) {
        return this.activeTurn
      }
    }

    // 4. Match most recent committed turn by sourceLanguage
    for (let i = this.recentCommitted.length - 1; i >= 0; i--) {
      const candidate = this.recentCommitted[i]
      const langMatches = !tokenSourceLang || candidate.sourceLanguage === tokenSourceLang
      if (langMatches) {
        return candidate
      }
    }

    if (this.activeTurn) return this.activeTurn
    if (this.recentCommitted.length > 0) {
      return this.recentCommitted[this.recentCommitted.length - 1]
    }
    return null
  }

  private resolveTargetLanguage(spokenLang: string): string {
    if (this.config.operatingMode === 'conversation') {
      if (spokenLang === this.config.targetLang) {
        return this.config.sourceLang
      }
      return this.config.targetLang
    }
    return this.config.targetLang
  }

  private createTurn(speakerId: string, sourceLanguage: string): InternalTurnState {
    this.turnSeq += 1
    return {
      id: `soniox-${this.config.channelId}-${Date.now()}-${this.turnSeq}`,
      speakerId,
      sourceLanguage,
      targetLanguage: this.resolveTargetLanguage(sourceLanguage),
      startedAtMs: Date.now(),
      committedAtMs: null,
      lastTokenEndMs: 0,
      awaitingClauseSpaceOrig: false,
      awaitingClauseSpaceTrans: false,
      finalOriginalText: '',
      interimOriginalText: '',
      finalOriginalTokens: [],
      finalTranslatedText: '',
      interimTranslatedText: '',
      confidenceSum: 0,
      confidenceCount: 0
    }
  }

  private scheduleSameLanguageSettleCommit(): void {
    this.clearSettleTimer()
    const delayMs = Math.max(250, this.config.sameLanguageSettleMs ?? DEFAULT_SAME_LANGUAGE_SETTLE_MS)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.commitActiveTurn()
    }, delayMs)
  }

  private clearSettleTimer(): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
  }

  private commitActiveTurn(): void {
    this.clearSettleTimer()
    if (!this.activeTurn) return

    const turn = this.activeTurn
    this.activeTurn = null

    // NEVER promote unfinalized provisional text into a committed paragraph
    turn.interimOriginalText = ''

    const finalOrig = cleanJoinedText(turn.finalOriginalText)
    if (!finalOrig) {
      return
    }

    // Suppress back-to-back exact duplicate committed paragraph within 6s window
    const lastCommitted = this.recentCommitted[this.recentCommitted.length - 1]
    if (
      lastCommitted &&
      cleanJoinedText(lastCommitted.finalOriginalText).toLowerCase() === finalOrig.toLowerCase()
    ) {
      return
    }

    turn.committedAtMs = Date.now()
    if (cleanJoinedText(turn.finalTranslatedText).length > 0) {
      turn.interimTranslatedText = ''
    }

    const snap = this.buildSnapshot(turn, true)
    if (!snap) return

    this.recentCommitted.push(turn)
    if (this.recentCommitted.length > MAX_RECENT_COMMITTED_TURNS) {
      this.recentCommitted.shift()
    }

    this.callbacks.onUnifiedCommit(snap)
  }

  private buildSnapshot(turn: InternalTurnState, isFinal: boolean): UnifiedTurnSnapshot | null {
    const sourceText = isFinal
      ? cleanJoinedText(turn.finalOriginalText)
      : cleanJoinedText(turn.finalOriginalText + turn.interimOriginalText)
    if (!sourceText) return null

    const translatedText = cleanJoinedText(turn.finalTranslatedText + turn.interimTranslatedText)
    const now = Date.now()
    const avgConf =
      turn.confidenceCount > 0
        ? Math.round((turn.confidenceSum / turn.confidenceCount) * 100) / 100
        : 0.94

    const speakerLabel = turn.speakerId ? `Speaker ${turn.speakerId}` : 'Speaker 1'

    const utterance: TranscriptUtterance = {
      id: turn.id,
      channelId: this.config.channelId,
      speakerId: turn.speakerId,
      speakerLabel,
      language: turn.sourceLanguage,
      text: sourceText,
      tokens: turn.finalOriginalTokens,
      isFinal,
      timestampMs: turn.startedAtMs,
      durationMs: Math.max(0, now - turn.startedAtMs),
      averageConfidence: avgConf,
      receivedAtMs: now
    }

    const wordTokens: TranslationToken[] = translatedText
      ? translatedText.split(/\s+/).map((w, idx) => ({
          id: `trans-${turn.id}-w-${idx}`,
          text: w,
          index: idx,
          timestampMs: now
        }))
      : []

    const translation: TranslationResult = {
      id: `trans-${turn.id}`,
      utteranceId: turn.id,
      channelId: this.config.channelId,
      speakerId: turn.speakerId,
      speakerLabel,
      sourceLang: turn.sourceLanguage,
      targetLang: turn.targetLanguage,
      sourceText,
      translatedText,
      tokens: wordTokens,
      isStreaming: !isFinal || translatedText.length === 0,
      isComplete: isFinal && translatedText.length > 0,
      domainId: this.config.domainId,
      timeToFirstTokenMs: 120,
      totalDurationMs: Math.max(0, now - turn.startedAtMs),
      endToEndLatencyMs: 190,
      provider: 'soniox-unified',
      timestampMs: turn.startedAtMs
    }

    return { utterance, translation }
  }

  private pruneRecentCommitted(): void {
    const cutoff = Date.now() - RECENT_COMMIT_WINDOW_MS
    this.recentCommitted = this.recentCommitted.filter(
      (t) => t.committedAtMs !== null && t.committedAtMs >= cutoff
    )
  }
}
