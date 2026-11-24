/**
 * DUALAI - Source Utterance Row Component (Left Pane)
 * Renders clean, boxless flowing paragraph entries with zero repetitive per-message titles.
 * Live in-progress speech renders in a softer font weight and locks into crisp final typography
 * once the 2-second end-of-speech pause commit fires.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Edit2, Check, X, AlertTriangle } from 'lucide-react'
import { TranscriptUtterance } from '../../../../types/stt'
import { highlightCriticalEntities } from '../../utils/entityHighlighter'

interface UtteranceCardProps {
  utterance: TranscriptUtterance
  isInterim?: boolean
  isFlagged?: boolean
  isOppositeDirection?: boolean
  onUpdateSpeakerLabel: (utteranceId: string, newLabel: string) => void
}

export const UtteranceCard: React.FC<UtteranceCardProps> = ({
  utterance,
  isInterim = false,
  isFlagged = false,
  isOppositeDirection = false,
  onUpdateSpeakerLabel
}) => {
  const [isEditingSpeaker, setIsEditingSpeaker] = useState(false)
  const [speakerDraft, setSpeakerDraft] = useState(utterance.speakerLabel)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditingSpeaker && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditingSpeaker])

  const handleSaveSpeaker = () => {
    const trimmed = speakerDraft.trim()
    if (trimmed && trimmed !== utterance.speakerLabel) {
      onUpdateSpeakerLabel(utterance.id, trimmed)
    }
    setIsEditingSpeaker(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveSpeaker()
    } else if (e.key === 'Escape') {
      setSpeakerDraft(utterance.speakerLabel)
      setIsEditingSpeaker(false)
    }
  }

  const timeFormatted = new Date(utterance.timestampMs).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  })

  const isCustomSpeaker =
    utterance.speakerLabel !== 'Channel A (Mic)' &&
    utterance.speakerLabel !== 'Channel B (System)'

  const hasLowConfidenceTokens = utterance.tokens.some((t) => t.isLowConfidence)
  const showPersistentMeta = isEditingSpeaker || isCustomSpeaker || isFlagged

  const speakerColorClass = (() => {
    const spk = utterance.speakerId
    if (spk === '3') {
      return isInterim ? 'font-light text-sky-300/65' : 'font-normal text-sky-300/95'
    }
    if (spk && spk !== '1' && spk !== '2') {
      return isInterim ? 'font-light text-emerald-300/65' : 'font-normal text-emerald-300/95'
    }
    if (spk === '2' || isOppositeDirection) {
      return isInterim ? 'font-light text-amber-300/65' : 'font-normal text-amber-300/95'
    }
    return isInterim ? 'font-light text-zinc-400/90' : 'font-normal text-zinc-300'
  })()

  return (
    <div className="group relative text-sm font-sans">
      {/* Flowing, Boxless Source Paragraph (Zero Per-Message Title Clutter) */}
      <div
        className={`text-[14px] leading-relaxed select-text transition-colors duration-300 ${speakerColorClass}`}
      >
        {hasLowConfidenceTokens && !isInterim ? (
          <span>
            {utterance.tokens.map((tok, idx) => (
              <span key={tok.id}>
                <span
                  className={
                    tok.isLowConfidence
                      ? 'border-b border-dotted border-accent-amber/80 text-text-primary'
                      : undefined
                  }
                  title={
                    tok.isLowConfidence
                      ? `Low ASR confidence (${Math.round(tok.confidence * 100)}%)`
                      : undefined
                  }
                >
                  {tok.text}
                </span>
                {idx < utterance.tokens.length - 1 ? ' ' : ''}
              </span>
            ))}
          </span>
        ) : (
          highlightCriticalEntities(utterance.text)
        )}
      </div>

      {/* Whisper-Quiet Metadata Rail (Shown Only on Hover, Custom Speaker, Edit, or Flag) */}
      {!isInterim && (
        <div
          className={`mt-1 flex items-center justify-between text-[10px] font-mono transition-opacity ${
            showPersistentMeta
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 h-0 overflow-hidden group-hover:h-auto'
          }`}
        >
          <div className="flex items-center space-x-2">
            {isEditingSpeaker ? (
              <div className="flex items-center space-x-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={speakerDraft}
                  onChange={(e) => setSpeakerDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-28 rounded border border-accent-steel bg-surface-panel px-1.5 py-0.5 text-[10px] font-mono text-text-primary outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveSpeaker}
                  className="p-0.5 text-accent-emerald hover:text-emerald-300"
                  title="Save speaker label"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSpeakerDraft(utterance.speakerLabel)
                    setIsEditingSpeaker(false)
                  }}
                  className="p-0.5 text-text-muted hover:text-text-primary"
                  title="Cancel"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingSpeaker(true)}
                className="flex items-center space-x-1 text-text-muted hover:text-text-primary"
                title="Click to rename speaker"
              >
                <span>{utterance.speakerLabel}</span>
                <Edit2 className="h-2.5 w-2.5" />
              </button>
            )}

            {isFlagged && (
              <span className="flex items-center space-x-1 text-[10px] font-semibold text-accent-amber">
                <AlertTriangle className="h-3 w-3" />
                <span>Flagged</span>
              </span>
            )}
          </div>

          <span className="text-text-muted">{timeFormatted}</span>
        </div>
      )}
    </div>
  )
}
