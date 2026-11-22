/**
 * DUALAI - Source Utterance Card Component (Left Pane)
 * Renders original speaker utterances, audio channel badges, timestamps,
 * inline editable speaker designations, and high-contrast entity highlighting.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Mic, Monitor, Clock, Edit2, Check, X, AlertTriangle } from 'lucide-react'
import { TranscriptUtterance } from '../../../../types/stt'
import { highlightCriticalEntities } from '../../utils/entityHighlighter'

interface UtteranceCardProps {
  utterance: TranscriptUtterance
  isInterim?: boolean
  isFlagged?: boolean
  sourceLang: string
  onUpdateSpeakerLabel: (utteranceId: string, newLabel: string) => void
}

export const UtteranceCard: React.FC<UtteranceCardProps> = ({
  utterance,
  isInterim = false,
  isFlagged = false,
  sourceLang,
  onUpdateSpeakerLabel
}) => {
  const isChannelA = utterance.channelId === 'channel_a'
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
    minute: '2-digit',
    second: '2-digit'
  })

  return (
    <div
      className={`rounded-lg border p-3.5 space-y-2.5 transition-all text-xs font-sans ${
        isInterim
          ? 'border-accent-steel/50 bg-surface-active/90 ring-1 ring-accent-steel/30'
          : isFlagged
            ? 'border-accent-amber/60 bg-surface-panel ring-1 ring-accent-amber/20'
            : 'border-surface-border bg-surface-panel hover:border-surface-border/80'
      }`}
    >
      {/* Header Strip */}
      <div className="flex items-center justify-between text-xs font-mono border-b border-surface-border-subtle pb-2">
        <div className="flex items-center space-x-2">
          {/* Source Icon & Channel Badge */}
          {isChannelA ? (
            <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold border border-accent-steel/30 bg-accent-steel/10 text-accent-steel">
              <Mic className="h-3 w-3" strokeWidth={2} />
              <span>CH A (MIC)</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold border border-accent-amber/30 bg-accent-amber/10 text-accent-amber">
              <Monitor className="h-3 w-3" strokeWidth={2} />
              <span>CH B (SYS)</span>
            </span>
          )}

          {/* Editable Speaker Label */}
          {isEditingSpeaker ? (
            <div className="flex items-center space-x-1">
              <input
                ref={inputRef}
                type="text"
                value={speakerDraft}
                onChange={(e) => setSpeakerDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                className="px-1.5 py-0.5 text-xs font-mono bg-surface-base border border-accent-steel rounded text-text-primary outline-none w-28"
              />
              <button
                type="button"
                onClick={handleSaveSpeaker}
                className="p-0.5 text-accent-emerald hover:text-emerald-300"
                title="Save speaker label"
              >
                <Check className="h-3.5 w-3.5" />
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
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingSpeaker(true)}
              className="flex items-center space-x-1 font-semibold text-text-primary hover:text-accent-steel group transition-colors"
              title="Click to rename speaker"
            >
              <span>{utterance.speakerLabel}</span>
              <Edit2 className="h-2.5 w-2.5 text-text-muted group-hover:text-accent-steel opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}

          {/* Language Code Pill */}
          <span className="text-[10px] font-mono text-text-muted px-1.5 py-0.2 bg-surface-base border border-surface-border rounded">
            {sourceLang.toUpperCase()}
          </span>
        </div>

        {/* Timestamp and Telemetry */}
        <div className="flex items-center space-x-2 text-[11px] text-text-muted">
          {isFlagged && (
            <span className="flex items-center space-x-1 text-accent-amber font-mono text-[10px] px-1.5 py-0.2 rounded bg-accent-amber/15 border border-accent-amber/30">
              <AlertTriangle className="h-3 w-3 inline" />
              <span>FLAGGED</span>
            </span>
          )}
          {isInterim ? (
            <span className="flex items-center space-x-1 text-accent-emerald font-semibold animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald" />
              <span>SPEAKING</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1">
              <Clock className="h-3 w-3" strokeWidth={1.5} />
              <span>{timeFormatted}</span>
            </span>
          )}
        </div>
      </div>

      {/* Utterance Body with Entity Highlighting */}
      <div className="text-[13px] leading-relaxed select-text font-normal text-text-primary pl-0.5">
        {highlightCriticalEntities(utterance.text)}
        {isInterim && (
          <span className="inline-block w-1.5 h-3.5 bg-accent-steel/80 ml-1 animate-pulse align-middle" />
        )}
      </div>
    </div>
  )
}
