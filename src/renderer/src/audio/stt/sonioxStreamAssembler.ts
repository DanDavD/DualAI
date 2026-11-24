/**
 * DUALAI - Soniox Unified Real-Time Token Stream Assembler
 * Processes single-pipeline Soniox tokens containing:
 *  - Original speech tokens (`translation_status: 'original' | 'none'`)
 *  - Simultaneous translation tokens (`translation_status: 'translation'`)
 *  - Real-time multi-speaker diarization (`speaker: "1" | "2" | "3" ...`)
 *  - Automatic two-way language detection (`language`, `source_language`)
 *  - Semantic endpoint markers (`<end>`, `<fin>`)
 * Separates 3+ speakers cleanly with instant commit on speaker/language switch
 * and reconciles trailing translation tokens that arrive milliseconds after `<end>`.
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
  pauseFallbackMs?: number
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
  finalOriginalText: string
  interimOriginalText: string
  finalOriginalTokens: TranscriptToken[]
  finalTranslatedText: string
  interimTranslatedText: string
  confidenceSum: number
  confidenceCount: number
}

const SPECIAL_END_TOKENS = new Set(['<end>', '<fin>'])
const RECENT_COMMIT_WINDOW_MS = 5000

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

function normalizeLang(lang?: string): string | undefined {
  if (!lang) return undefined
  return lang.trim().toLowerCase().slice(0, 5)
}

export class SonioxStreamAssembler {
  private config: SonioxAssemblerConfig
  private callbacks: SonioxAssemblerCallbacks
  private activeTurn: InternalTurnState | null = null
  private recentCommitted: InternalTurnState[] = []
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private turnSeq: number = 0

  constructor(config: SonioxAssemblerConfig, callbacks: SonioxAssemblerCallbacks) {
    this.config = {
      ...config,
      pauseFallbackMs: config.pauseFallbackMs ?? 2000
    }
    this.callbacks = callbacks
  }

  public updateConfig(partial: Partial<SonioxAssemblerConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  public ingestTokens(rawTokens: SonioxRawToken[]): void {
    if (!Array.isArray(rawTokens) || rawTokens.length === 0) return

    this.pruneRecentCommitted()

    // Non-final tokens in each Soniox frame replace previous provisional tails
    let frameInterimOriginal = ''
    let frameInterimTranslation = ''
    let sawOriginalActivity = false
    let sawTranslationActivity = false
    let hitEndpoint = false

    const updatedCommittedTurns = new Set<InternalTurnState>()

    for (const raw of rawTokens) {
      if (!raw || typeof raw.text !== 'string' || raw.text.length === 0) continue

      if (SPECIAL_END_TOKENS.has(raw.text)) {
        hitEndpoint = true
        continue
      }

      const isFinal = Boolean(raw.is_final)
      const isTranslation = raw.translation_status === 'translation'
      const tokenSpeaker = normalizeSpeaker(raw.speaker)
      const tokenLang = normalizeLang(raw.language)
      const tokenSourceLang = normalizeLang(raw.source_language)

      if (isTranslation) {
        sawTranslationActivity = true
        const targetTurn = this.resolveTranslationTargetTurn(tokenSpeaker, tokenSourceLang)

        if (targetTurn) {
          if (targetTurn === this.activeTurn) {
            if (isFinal) {
              targetTurn.finalTranslatedText += raw.text
              targetTurn.interimTranslatedText = ''
            } else {
              frameInterimTranslation += raw.text
            }
          } else {
            // Patch recently committed turn whose trailing translation arrived right after <end> or speaker switch
            if (isFinal) {
              targetTurn.finalTranslatedText += raw.text
              targetTurn.interimTranslatedText = ''
            } else {
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
      const effectiveLang = tokenLang || this.activeTurn?.sourceLanguage || this.config.sourceLang

      // Check for speaker change or language change -> instant turn split (0ms wait!)
      if (this.activeTurn && this.shouldSplitTurn(this.activeTurn, tokenSpeaker, tokenLang)) {
        // Flush any interim accumulated so far before splitting
        if (frameInterimOriginal) {
          this.activeTurn.interimOriginalText = frameInterimOriginal
          frameInterimOriginal = ''
        }
        if (frameInterimTranslation) {
          this.activeTurn.interimTranslatedText = frameInterimTranslation
          frameInterimTranslation = ''
        }
        this.commitActiveTurn()
      }

      if (!this.activeTurn) {
        this.activeTurn = this.createTurn(effectiveSpeaker, effectiveLang)
      } else {
        if (tokenSpeaker) this.activeTurn.speakerId = tokenSpeaker
        if (tokenLang) {
          this.activeTurn.sourceLanguage = tokenLang
          this.activeTurn.targetLanguage = this.resolveTargetLanguage(tokenLang)
        }
      }

      if (isFinal) {
        this.activeTurn.finalOriginalText += raw.text
        this.activeTurn.interimOriginalText = ''
        const conf = typeof raw.confidence === 'number' ? raw.confidence : 0.94
        const roundedConf = Math.round(conf * 100) / 100
        this.activeTurn.confidenceSum += roundedConf
        this.activeTurn.confidenceCount += 1

        const trimmedWord = raw.text.trim()
        if (trimmedWord) {
          this.activeTurn.finalOriginalTokens.push({
            id: `${this.activeTurn.id}-tok-${this.activeTurn.finalOriginalTokens.length}`,
            text: trimmedWord,
            confidence: roundedConf,
            isLowConfidence: roundedConf < this.config.confidenceThreshold,
            startTimeMs: raw.start_ms ?? 0,
            endTimeMs: raw.end_ms ?? 0,
            isPunctuated: true,
            speakerId: this.activeTurn.speakerId
          })
        }
      } else {
        frameInterimOriginal += raw.text
      }
    }

    // Emit updates for any recently committed turns that received trailing translation tokens
    for (const committedTurn of updatedCommittedTurns) {
      const snap = this.buildSnapshot(committedTurn, true)
      if (snap) {
        this.callbacks.onUnifiedCommitUpdate(snap)
      }
    }

    if (this.activeTurn) {
      if (sawOriginalActivity || hitEndpoint) {
        this.activeTurn.interimOriginalText = hitEndpoint ? '' : frameInterimOriginal
      }
      if (sawTranslationActivity || hitEndpoint) {
        this.activeTurn.interimTranslatedText = hitEndpoint ? '' : frameInterimTranslation
      }

      if (hitEndpoint) {
        this.commitActiveTurn()
        return
      }

      this.resetPauseFallbackTimer()
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
    this.clearPauseTimer()
    this.activeTurn = null
    this.recentCommitted = []
  }

  private shouldSplitTurn(
    current: InternalTurnState,
    nextSpeaker?: string,
    nextLang?: string
  ): boolean {
    const hasExistingContent =
      cleanJoinedText(current.finalOriginalText + current.interimOriginalText).length > 0
    if (!hasExistingContent) return false

    if (nextSpeaker && current.speakerId && nextSpeaker !== current.speakerId) {
      return true
    }

    if (
      this.config.operatingMode === 'conversation' &&
      nextLang &&
      current.sourceLanguage &&
      nextLang !== current.sourceLanguage &&
      cleanJoinedText(current.finalOriginalText).length > 0
    ) {
      return true
    }

    return false
  }

  private resolveTranslationTargetTurn(
    tokenSpeaker?: string,
    tokenSourceLang?: string
  ): InternalTurnState | null {
    // 1. Prefer an exact speaker+language match in activeTurn
    if (this.activeTurn) {
      const speakerMatches = !tokenSpeaker || this.activeTurn.speakerId === tokenSpeaker
      const langMatches = !tokenSourceLang || this.activeTurn.sourceLanguage === tokenSourceLang
      if (speakerMatches && langMatches) {
        return this.activeTurn
      }
    }

    // 2. Check recently committed turns (most recent first) for trailing translation tokens
    for (let i = this.recentCommitted.length - 1; i >= 0; i--) {
      const candidate = this.recentCommitted[i]
      const speakerMatches = !tokenSpeaker || candidate.speakerId === tokenSpeaker
      const langMatches = !tokenSourceLang || candidate.sourceLanguage === tokenSourceLang
      if (speakerMatches && langMatches) {
        return candidate
      }
    }

    // 3. Fallback to activeTurn or latest committed turn
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
      finalOriginalText: '',
      interimOriginalText: '',
      finalOriginalTokens: [],
      finalTranslatedText: '',
      interimTranslatedText: '',
      confidenceSum: 0,
      confidenceCount: 0
    }
  }

  private commitActiveTurn(): void {
    this.clearPauseTimer()
    if (!this.activeTurn) return

    const turn = this.activeTurn
    this.activeTurn = null
    turn.committedAtMs = Date.now()

    // Merge any unfinalized tail cleanly into final text on forced commit
    if (turn.interimOriginalText) {
      turn.finalOriginalText += turn.interimOriginalText
      turn.interimOriginalText = ''
    }
    if (turn.interimTranslatedText) {
      turn.finalTranslatedText += turn.interimTranslatedText
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
    const sourceText = cleanJoinedText(turn.finalOriginalText + turn.interimOriginalText)
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

  private resetPauseFallbackTimer(): void {
    this.clearPauseTimer()
    const delayMs = this.config.pauseFallbackMs ?? 2000
    this.pauseTimer = setTimeout(() => {
      this.commitActiveTurn()
    }, delayMs)
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
  }

  private pruneRecentCommitted(): void {
    const cutoff = Date.now() - RECENT_COMMIT_WINDOW_MS
    this.recentCommitted = this.recentCommitted.filter(
      (t) => t.committedAtMs !== null && t.committedAtMs >= cutoff
    )
  }
}
