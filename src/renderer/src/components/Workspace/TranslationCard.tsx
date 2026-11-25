/**
 * DUALAI - Target Translation Row Component (Right Pane / Translation)
 * Renders clean, boxless flowing paragraphs ("what to say") colored strictly by
 * SPOKEN LANGUAGE so all speakers of the same language share identical typography.
 * Live drafts render in softer weight/opacity and snap cleanly into final text on commit.
 */

import React, { useState } from 'react'
import { Copy, Check, BookmarkPlus, AlertTriangle, X } from 'lucide-react'
import { TranslationResult } from '../../../../types/translation'
import {
  DEFAULT_WORKSPACE_DISPLAY_SETTINGS,
  WorkspaceDisplaySettings
} from '../../../../types/settings'
import { highlightCriticalEntities } from '../../utils/entityHighlighter'
import {
  resolveFontFamilyCss,
  resolveLineSpacingMetrics
} from '../../utils/typographyPreferences'

interface TranslationCardProps {
  translation?: TranslationResult
  utteranceId: string
  isStreaming?: boolean
  isDraft?: boolean
  isWaitingForPause?: boolean
  isFlagged?: boolean
  textColor?: string
  displaySettings?: WorkspaceDisplaySettings
  onToggleFlag: (utteranceId: string) => void
  onAddToGlossary: (sourceTerm: string, targetTerm: string) => void
}

export const TranslationCard: React.FC<TranslationCardProps> = React.memo(({
  translation,
  utteranceId,
  isStreaming = false,
  isDraft = false,
  isWaitingForPause = false,
  isFlagged = false,
  textColor,
  displaySettings = DEFAULT_WORKSPACE_DISPLAY_SETTINGS,
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
  const fontMetrics = resolveFontFamilyCss(displaySettings.fontFamily)
  const lineMetrics = resolveLineSpacingMetrics(displaySettings.lineSpacing)
  const resolvedColor = textColor || displaySettings.languageAColor

  return (
    <div className="group relative text-sm select-none">
      {/* Quiet Hover-Only Action Rail (Zero Layout Shift) */}
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

      {/* Flowing Target Translation: Non-Selectable, GPU-Smooth Opacity Transition */}
      <div
        style={{
          fontFamily: fontMetrics.fontFamily,
          letterSpacing: fontMetrics.letterSpacing,
          fontSize: `${displaySettings.fontSizePx}px`,
          lineHeight: lineMetrics.lineHeight,
          color: resolvedColor,
          opacity: isInProgressVisual ? 0.62 : 1
        }}
        className={`select-none min-h-[22px] transition-opacity duration-150 ${
          isInProgressVisual ? 'font-light' : 'font-normal'
        }`}
      >
        {translation?.translatedText ? (
          highlightCriticalEntities(translation.translatedText)
        ) : isWaitingForPause ? (
          <span className="font-light text-text-muted text-xs italic">Listening...</span>
        ) : (
          <span className="font-light text-text-muted text-xs">Translating...</span>
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
})

TranslationCard.displayName = 'TranslationCard'
