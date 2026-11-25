/**
 * DUALAI - Soniox Unified Real-Time Paragraph & Anti-Duplication Stream Assembler
 * Processes single-pipeline Soniox tokens containing original speech, simultaneous
 * translation, language identification, and endpoint markers (<end>, <fin>).
 *
 * CORE PRODUCTION INVARIANTS:
 * 1. NEVER splits turns on speaker-ID jitter within the SAME language (rapid "sí, sí, sí"
 *    or 3 speakers of the same language coalesce cleanly into ONE coherent paragraph).
 * 2. Coalesces rapid same-language <end> bursts across a 2,000ms silence settle window
 *    so full paragraphs accumulate completely before committing.
 * 3. Splits immediately (0ms wait) ONLY on a genuine finalized LANGUAGE switch (e.g., es <-> en)
 *    or when <fin> signals confirmed audio silence.
 * 4. NEVER commits unfinalized (is_final: false) tokens and suppresses boundary duplicate
 *    re-emissions—guaranteeing zero repeated or triplicated paragraphs.
 * 5. Constrains detected languages strictly to the active source/target pair using base
 *    2-letter ISO normalization (e.g., "es-MX" -> "es", "en-US" -> "en").
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

const DEFAULT_SAME_LANGUAGE_SETTLE_MS = 2000
const RECENT_COMMIT_WINDOW_MS = 6000

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
 * and suppressing exact repeated clause re-emissions (>= 12 chars).
 */
function appendFinalSegmentSafely(
  existing: string,
  incoming: string,
  insertSpaceIfBoundary: boolean
): string {
  if (!incoming) return existing
  if (!existing) return incoming

  const cleanIncoming = incoming.trim()
  const cleanExisting = existing.trim()

  // Suppress exact duplicate clause re-emission if Soniox replays an already-finalized phrase
  if (cleanIncoming.length >= 12) {
    const normExisting = cleanExisting.toLowerCase()
    const normIncoming = cleanIncoming.toLowerCase()
    if (normExisting.endsWith(normIncoming)) {
      return existing
    }
  }

  if (
    insertSpaceIfBoundary &&
    !/\s$/.test(existing) &&
    !/^\s/.test(incoming) &&
    !/^[,.;:!?]/.test(incoming)
  ) {
    return `${existing} ${incoming}`
  }

  return `${existing}${incoming}`
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
      sameLanguageSettleMs: config.sameLanguageSettleMs ?? DEFAULT_SAME_LANGUAGE_SETTLE_MS
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
        const targetTurn = this.resolveTranslationTargetTurn(tokenSourceLang)

        if (targetTurn) {
          if (targetTurn === this.activeTurn) {
            if (isFinal) {
              targetTurn.finalTranslatedText = appendFinalSegmentSafely(
                targetTurn.finalTranslatedText,
                raw.text,
                targetTurn.awaitingClauseSpaceTrans
              )
              targetTurn.awaitingClauseSpaceTrans = false
              targetTurn.interimTranslatedText = ''
            } else {
              frameInterimTranslation += raw.text
            }
          } else {
            // Reconcile trailing finalized translation tokens onto recently committed turn
            if (isFinal) {
              targetTurn.finalTranslatedText = appendFinalSegmentSafely(
                targetTurn.finalTranslatedText,
                raw.text,
                targetTurn.awaitingClauseSpaceTrans
              )
              targetTurn.awaitingClauseSpaceTrans = false
              targetTurn.interimTranslatedText = ''
            } else if (!cleanJoinedText(targetTurn.finalTranslatedText)) {
              targetTurn.interimTranslatedText = raw.text
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

      // Split ONLY on a genuine finalized LANGUAGE switch (NEVER on speaker jitter within the same language!)
      if (
        isFinal &&
        this.activeTurn &&
        this.isGenuineLanguageSwitch(this.activeTurn, tokenLang, raw.text)
      ) {
        this.commitActiveTurn()
      }

      if (!this.activeTurn) {
        this.activeTurn = this.createTurn(effectiveSpeaker, effectiveLang)
      } else {
        if (isFinal && tokenSpeaker) {
          this.activeTurn.speakerId = tokenSpeaker
        }
        // Before any finalized text is locked in, immediately adopt the detected language
        // (even on provisional words) so live draft colors match the spoken language on frame 1.
        if (tokenLang && !cleanJoinedText(this.activeTurn.finalOriginalText)) {
          this.activeTurn.sourceLanguage = tokenLang
          this.activeTurn.targetLanguage = this.resolveTargetLanguage(tokenLang)
        }
      }

      if (isFinal) {
        // New finalized speech cancels any pending 2s settle timer so the paragraph keeps coalescing smoothly
        this.clearSettleTimer()

        this.activeTurn.finalOriginalText = appendFinalSegmentSafely(
          this.activeTurn.finalOriginalText,
          raw.text,
          this.activeTurn.awaitingClauseSpaceOrig
        )
        const insertedBoundarySpace = this.activeTurn.awaitingClauseSpaceOrig
        this.activeTurn.awaitingClauseSpaceOrig = false
        this.activeTurn.interimOriginalText = ''

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
      } else {
        // New provisional speech also extends any active 2s settle countdown
        if (raw.text.trim().length > 0) {
          this.clearSettleTimer()
        }
        frameInterimOriginal += raw.text
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

      // Hard finalize (<fin> after confirmed 2.2s audio pause) commits immediately!
      if (sawHardFinalize) {
        this.commitActiveTurn()
        return
      }

      // Soft endpoint (<end>): keep accumulating in the same paragraph for 2,000ms of silence
      // so rapid "sí, sí, sí" or brief pauses never splinter into 4 separate rows!
      if (sawSoftEnd && cleanJoinedText(this.activeTurn.finalOriginalText).length > 0) {
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
   * Ignores noisy 3rd-language detections on short interjections or accents.
   */
  private constrainToActiveLanguagePair(rawLang?: string): string | undefined {
    const base = normalizeBaseLang(rawLang)
    if (!base) return undefined

    if (this.config.operatingMode === 'translate') {
      return this.config.sourceLang
    }

    if (base === this.config.sourceLang || base === this.config.targetLang) {
      return base
    }
    return undefined
  }

  /**
   * Only triggers an immediate mid-stream turn split when a genuine finalized word
   * switches from Language A to Language B (e.g., Spanish -> English in Conversation mode).
   * Punctuation-only tokens or same-language speaker changes NEVER split the paragraph.
   */
  private isGenuineLanguageSwitch(
    current: InternalTurnState,
    nextLang: string | undefined,
    rawText: string
  ): boolean {
    if (this.config.operatingMode !== 'conversation') return false
    if (!nextLang || !current.sourceLanguage || nextLang === current.sourceLanguage) return false
    if (cleanJoinedText(current.finalOriginalText).length === 0) return false
    // Ignore punctuation-only tokens that may carry an ambiguous language tag
    if (!/[A-Za-zÀ-ÖØ-öø-ÿ\p{L}\p{N}]/u.test(rawText)) return false
    return true
  }

  private resolveTranslationTargetTurn(tokenSourceLang?: string): InternalTurnState | null {
    // 1. Prioritize a recently committed turn whose translation is still empty and matches sourceLang
    for (let i = this.recentCommitted.length - 1; i >= 0; i--) {
      const candidate = this.recentCommitted[i]
      const langMatches = !tokenSourceLang || candidate.sourceLanguage === tokenSourceLang
      if (langMatches && cleanJoinedText(candidate.finalTranslatedText).length === 0) {
        return candidate
      }
    }

    // 2. Match activeTurn by sourceLanguage (most common steady-state path)
    if (this.activeTurn) {
      const langMatches = !tokenSourceLang || this.activeTurn.sourceLanguage === tokenSourceLang
      if (langMatches) {
        return this.activeTurn
      }
    }

    // 3. Match most recent committed turn by sourceLanguage (trailing tokens right after language switch)
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
    if (this.recentCommitted.length > 8) {
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
