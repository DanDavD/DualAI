/**
 * DUALAI - Target Translation Row Component (Right Pane)
 * Renders clean, boxless flowing paragraphs ("what to say") with zero per-message titles.
 * - Live in-progress drafts (`isDraft` / `isStreaming`) render in a softer, lighter font weight
 *   so the reader visually knows the utterance is still evolving.
 * - Once the 2-second end-of-speech pause signal commits the paragraph, the translation locks
 *   smoothly into full-contrast final typography with hover-revealed inline actions.
 */

import React, { useState } from 'react'
import { Copy, Check, BookmarkPlus, AlertTriangle, X } from 'lucide-react'
import { TranslationResult } from '../../../../types/translation'
import { highlightCriticalEntities } from '../../utils/entityHighlighter'

interface TranslationCardProps {
  translation?: TranslationResult
  utteranceId: string
  isStreaming?: boolean
  isDraft?: boolean
  isWaitingForPause?: boolean
  isFlagged?: boolean
  isOppositeDirection?: boolean
  onToggleFlag: (utteranceId: string) => void
  onAddToGlossary: (sourceTerm: string, targetTerm: string) => void
}

export const TranslationCard: React.FC<TranslationCardProps> = ({
  translation,
  utteranceId,
  isStreaming = false,
  isDraft = false,
  isWaitingForPause = false,
  isFlagged = false,
  isOppositeDirection = false,
  onToggleFlag,
  onAddToGlossary
}) => {
  const [copied, setCopied] = useState(false)
  const [showGlossaryInput, setShowGlossaryInput] = useState(false)
  const [sourceTerm, setSourceTerm] = useState('')
  const [targetTerm, setTargetTerm] = useState('')

  const handleCopy = async () => {
    if (!translation?.translatedText) return
    try {
      await navigator.clipboard.writeText(translation.translatedText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (err) {
      console.warn('[DUALAI] Clipboard copy error:', err)
    }
  }

  const handleSaveGlossaryTerm = () => {
    if (sourceTerm.trim() && targetTerm.trim()) {
      onAddToGlossary(sourceTerm.trim(), targetTerm.trim())
      setShowGlossaryInput(false)
      setSourceTerm('')
      setTargetTerm('')
    }
  }

  const isInProgressVisual = isDraft || isStreaming
  const speakerToneClass = (() => {
    const spk = translation?.speakerId
    if (spk === '3') {
      return isInProgressVisual ? 'font-light text-sky-300/65' : 'font-normal text-sky-300'
    }
    if (spk && spk !== '1' && spk !== '2') {
      return isInProgressVisual ? 'font-light text-emerald-300/65' : 'font-normal text-emerald-300'
    }
    if (spk === '2' || isOppositeDirection) {
      return isInProgressVisual ? 'font-light text-amber-300/65' : 'font-normal text-amber-300'
    }
    return isInProgressVisual ? 'font-light text-zinc-400/85' : 'font-normal text-zinc-100'
  })()

  return (
    <div className="group relative text-sm font-sans">
      {/* Quiet Hover-Only Action Rail (Zero Per-Message Language Title Bar) */}
      {!isDraft && !isWaitingForPause && (
        <div
          className={`absolute -top-0.5 right-0 z-10 flex items-center space-x-1 rounded bg-surface-base/95 pl-2 font-mono transition-opacity ${
            isFlagged || copied || showGlossaryInput
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <button
            type="button"
            onClick={handleCopy}
            disabled={!translation?.translatedText}
            className={`flex items-center space-x-1 rounded px-1.5 py-0.5 text-[10px] transition ${
              copied
                ? 'text-accent-emerald'
                : 'text-text-muted hover:bg-surface-active hover:text-text-primary'
            }`}
            title="Copy translation"
            aria-label="Copy translation"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleFlag(utteranceId)}
            className={`flex items-center space-x-1 rounded px-1.5 py-0.5 text-[10px] transition ${
              isFlagged
                ? 'text-accent-amber font-semibold'
                : 'text-text-muted hover:bg-surface-active hover:text-text-primary'
            }`}
            title="Flag translation for review"
            aria-label="Flag translation"
          >
            <AlertTriangle className="h-3 w-3" />
            {isFlagged && <span>Flagged</span>}
          </button>

          <button
            type="button"
            onClick={() => setShowGlossaryInput((prev) => !prev)}
            className={`flex items-center space-x-1 rounded px-1.5 py-0.5 text-[10px] transition ${
              showGlossaryInput
                ? 'text-accent-steel'
                : 'text-text-muted hover:bg-surface-active hover:text-text-primary'
            }`}
            title="Add custom terminology to glossary"
            aria-label="Add terminology to glossary"
          >
            <BookmarkPlus className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Flowing Target Translation: Softer Draft Font -> Crisp Final Typography on 2s Commit */}
      <div
        className={`text-[15px] leading-relaxed select-text min-h-[22px] transition-colors duration-300 ${speakerToneClass}`}
      >
        {translation?.translatedText ? (
          highlightCriticalEntities(translation.translatedText)
        ) : isWaitingForPause ? (
          <span className="font-light text-text-muted text-xs italic">Listening...</span>
        ) : isStreaming || isDraft ? (
          <span className="font-light text-text-muted text-xs">Translating...</span>
        ) : (
          <span className="font-light text-text-muted text-xs italic">Translating...</span>
        )}
        {isStreaming && translation?.translatedText && (
          <span className="inline-block w-1.5 h-3.5 bg-accent-emerald/70 ml-1 animate-pulse align-middle" />
        )}
      </div>

      {/* Optional Inline Glossary Quick-Add (Hidden by Default) */}
      {showGlossaryInput && (
        <div className="mt-2 flex items-center space-x-1.5 rounded border border-surface-border bg-surface-panel p-2 text-xs font-mono">
          <input
            type="text"
            placeholder="Source term"
            value={sourceTerm}
            onChange={(e) => setSourceTerm(e.target.value)}
            className="flex-1 rounded border border-surface-border bg-surface-base px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent-steel"
          />
          <span className="text-text-muted">{'->'}</span>
          <input
            type="text"
            placeholder="Target term"
            value={targetTerm}
            onChange={(e) => setTargetTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveGlossaryTerm()
            }}
            className="flex-1 rounded border border-surface-border bg-surface-base px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent-steel"
          />
          <button
            type="button"
            onClick={handleSaveGlossaryTerm}
            className="rounded bg-accent-steel px-2 py-1 text-[10px] font-semibold text-white hover:bg-blue-700"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setShowGlossaryInput(false)}
            className="p-1 text-text-muted hover:text-text-primary"
            aria-label="Close glossary quick add"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
