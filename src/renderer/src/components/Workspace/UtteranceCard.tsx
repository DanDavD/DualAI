/**
 * DUALAI - Source Utterance Row Component (Left Pane / Original)
 * Renders clean, boxless flowing paragraphs colored strictly by SPOKEN LANGUAGE
 * (so all speakers of the same language share identical font, size, and color).
 * Live in-progress drafts render softer and transition smoothly into crisp final typography.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Edit2, Check, X, AlertTriangle } from 'lucide-react'
import { TranscriptUtterance } from '../../../../types/stt'
import {
  DEFAULT_WORKSPACE_DISPLAY_SETTINGS,
  WorkspaceDisplaySettings
} from '../../../../types/settings'
import { highlightCriticalEntities } from '../../utils/entityHighlighter'
import {
  resolveFontFamilyCss,
  resolveLineSpacingMetrics
} from '../../utils/typographyPreferences'

interface UtteranceCardProps {
  utterance: TranscriptUtterance
  isInterim?: boolean
  isFlagged?: boolean
  isStacked?: boolean
  textColor?: string
  displaySettings?: WorkspaceDisplaySettings
  onUpdateSpeakerLabel: (utteranceId: string, newLabel: string) => void
}

function isDefaultAutoSpeakerLabel(label: string): boolean {
  return (
    label === 'Channel A (Mic)' ||
    label === 'Channel B (System)' ||
    /^Speaker \d+$/i.test(label.trim())
  )
}

export const UtteranceCard: React.FC<UtteranceCardProps> = React.memo(({
  utterance,
  isInterim = false,
  isFlagged = false,
  isStacked = false,
  textColor,
  displaySettings = DEFAULT_WORKSPACE_DISPLAY_SETTINGS,
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

  const isCustomSpeaker = !isDefaultAutoSpeakerLabel(utterance.speakerLabel)
  const fontMetrics = resolveFontFamilyCss(displaySettings.fontFamily)
  const lineMetrics = resolveLineSpacingMetrics(displaySettings.lineSpacing)
  const sourceFontSizePx = isStacked
    ? Math.max(12, displaySettings.fontSizePx - 2)
    : Math.max(12, displaySettings.fontSizePx - 1)

  const resolvedColor = textColor || displaySettings.languageAColor
  const showPersistentMeta = isEditingSpeaker || isCustomSpeaker || isFlagged

  return (
    <div className="group relative text-sm select-none">
      {/* Flowing, Boxless Source Paragraph (Non-Selectable, Zero Hover Layout Shift, GPU-Smooth) */}
      <div
        style={{
          fontFamily: fontMetrics.fontFamily,
          letterSpacing: fontMetrics.letterSpacing,
          fontSize: `${sourceFontSizePx}px`,
          lineHeight: lineMetrics.lineHeight,
          color: resolvedColor,
          opacity: isInterim ? 0.6 : isStacked ? 0.85 : 1
        }}
        className={`select-none transition-opacity duration-150 ${
          isInterim ? 'font-light' : 'font-normal'
        }`}
      >
        {highlightCriticalEntities(utterance.text)}
      </div>

      {/* Zero-Shift Persistent Meta (Rendered ONLY When Explicitly Renamed, Editing, or Flagged) */}
      {!isInterim && showPersistentMeta && (
        <div className="mt-1 flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center space-x-2">
            {isEditingSpeaker ? (
              <div className="flex items-center space-x-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={speakerDraft}
                  onChange={(e) => setSpeakerDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-28 rounded border border-accent-steel bg-surface-panel px-1.5 py-0.5 text-[10px] font-mono text-text-primary outline-none select-text"
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
})

UtteranceCard.displayName = 'UtteranceCard'
