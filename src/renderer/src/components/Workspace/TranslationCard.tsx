/**
 * DUALAI - Target Translation Card Component (Right Pane)
 * Renders aligned real-time translations, domain directives (ICD-10, Verbatim Legal),
 * high-contrast critical entity highlighting, and an inline Action Rail (Copy, Flag, Terminology).
 */

import React, { useState } from 'react'
import {
  Copy,
  Check,
  BookmarkPlus,
  AlertTriangle,
  Zap,
  BookOpen,
  Sparkles,
  X
} from 'lucide-react'
import { TranslationResult } from '../../../../types/translation'
import { highlightCriticalEntities } from '../../utils/entityHighlighter'

interface TranslationCardProps {
  translation?: TranslationResult
  utteranceId: string
  isStreaming?: boolean
  isFlagged?: boolean
  targetLang: string
  onToggleFlag: (utteranceId: string) => void
  onAddToGlossary: (sourceTerm: string, targetTerm: string) => void
}

export const TranslationCard: React.FC<TranslationCardProps> = ({
  translation,
  utteranceId,
  isStreaming = false,
  isFlagged = false,
  targetLang,
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
      setTimeout(() => setCopied(false), 2000)
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

  const getDomainLabel = (domainId?: string) => {
    switch (domainId) {
      case 'medical':
        return { label: 'ICD-10 CLINICAL', cls: 'border-accent-emerald/30 bg-accent-emerald/10 text-accent-emerald' }
      case 'legal':
        return { label: 'VERBATIM STATUTORY', cls: 'border-accent-steel/30 bg-accent-steel/10 text-accent-steel' }
      case 'technical':
        return { label: 'TECHNICAL SYSTEMS', cls: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber' }
      case 'business':
        return { label: 'EXECUTIVE SUMMIT', cls: 'border-purple-400/30 bg-purple-400/10 text-purple-300' }
      default:
        return { label: 'GENERAL REGISTER', cls: 'border-surface-border bg-surface-base text-text-secondary' }
    }
  }

  const domain = getDomainLabel(translation?.domainId)

  return (
    <div
      className={`rounded-lg border p-3.5 space-y-2.5 transition-all text-xs font-sans group ${
        isStreaming
          ? 'border-accent-emerald/50 bg-surface-active/90 ring-1 ring-accent-emerald/30'
          : isFlagged
            ? 'border-accent-amber/60 bg-surface-panel ring-1 ring-accent-amber/20'
            : 'border-surface-border bg-surface-panel hover:border-surface-border/80'
      }`}
    >
      {/* Header Strip with Domain Directive & Telemetry */}
      <div className="flex items-center justify-between text-xs font-mono border-b border-surface-border-subtle pb-2">
        <div className="flex items-center space-x-2">
          {/* Target Language Pill */}
          <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-surface-base border border-surface-border text-accent-emerald">
            {targetLang.toUpperCase()} - TARGET
          </span>

          {/* Domain Directive Badge */}
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${domain.cls}`}>
            {domain.label}
          </span>
        </div>

        {/* Latency Telemetry */}
        <div className="flex items-center space-x-2 text-[11px] font-mono text-text-muted">
          {isStreaming ? (
            <span className="flex items-center space-x-1 text-accent-emerald font-semibold animate-pulse">
              <Zap className="h-3 w-3" strokeWidth={2} />
              <span>TRANSLATING</span>
            </span>
          ) : translation ? (
            <div className="flex items-center space-x-1.5">
              <span>TTFT: <strong className="text-accent-emerald">{translation.timeToFirstTokenMs}ms</strong></span>
              <span className="text-surface-border">|</span>
              <span>E2E: <strong className="text-accent-steel">{translation.endToEndLatencyMs}ms</strong></span>
            </div>
          ) : (
            <span>PENDING</span>
          )}
        </div>
      </div>

      {/* Translated Body with High-Contrast Entity Highlighting */}
      <div className="text-[13px] leading-relaxed select-text font-medium text-text-primary pl-0.5 min-h-[22px]">
        {translation?.translatedText ? (
          highlightCriticalEntities(translation.translatedText)
        ) : isStreaming ? (
          <span className="text-text-muted font-mono text-xs flex items-center space-x-1.5 animate-pulse">
            <Sparkles className="h-3 w-3 text-accent-emerald" />
            <span>Generating domain translation...</span>
          </span>
        ) : (
          <span className="text-text-muted italic">Awaiting speech pause...</span>
        )}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3.5 bg-accent-emerald ml-1 animate-pulse align-middle" />
        )}
      </div>

      {/* Action Rail (Acceptance Criterion 4) */}
      <div className="flex items-center justify-between border-t border-surface-border-subtle pt-2 text-[11px] font-mono">
        <div className="flex items-center space-x-1">
          {/* Action 1: Instant Copy */}
          <button
            type="button"
            onClick={handleCopy}
            disabled={!translation?.translatedText}
            className={`flex items-center space-x-1 px-2 py-1 rounded transition border ${
              copied
                ? 'bg-accent-emerald/20 text-accent-emerald border-accent-emerald/40'
                : 'bg-surface-base text-text-secondary border-surface-border hover:text-text-primary hover:bg-surface-active'
            }`}
            title="Copy translation to clipboard"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-accent-emerald" strokeWidth={2} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" strokeWidth={1.5} />
                <span>Copy</span>
              </>
            )}
          </button>

          {/* Action 2: Instant Flag for Audit */}
          <button
            type="button"
            onClick={() => onToggleFlag(utteranceId)}
            className={`flex items-center space-x-1 px-2 py-1 rounded transition border ${
              isFlagged
                ? 'bg-accent-amber/20 text-accent-amber border-accent-amber/50 font-bold'
                : 'bg-surface-base text-text-secondary border-surface-border hover:text-text-primary hover:bg-surface-active'
            }`}
            title="Flag utterance for quality audit or review"
          >
            <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
            <span>{isFlagged ? 'Flagged' : 'Flag'}</span>
          </button>

          {/* Action 3: Add to Custom Terminology / Glossary */}
          <button
            type="button"
            onClick={() => {
              if (translation) {
                setSourceTerm(translation.sourceText)
                setTargetTerm(translation.translatedText)
              }
              setShowGlossaryInput(!showGlossaryInput)
            }}
            disabled={!translation}
            className="flex items-center space-x-1 px-2 py-1 rounded transition border bg-surface-base text-text-secondary border-surface-border hover:text-text-primary hover:bg-surface-active"
            title="Add to custom domain glossary for prompt injection"
          >
            <BookmarkPlus className="h-3 w-3" strokeWidth={1.5} />
            <span>+ Terminology</span>
          </button>
        </div>

        <div className="text-text-muted text-[10px]">
          {translation?.provider === 'gemini-2.0-flash' ? 'GEMINI 2.0 FLASH' : 'OFFLINE SIMULATOR'}
        </div>
      </div>

      {/* Inline Terminology Addition Quick Form */}
      {showGlossaryInput && (
        <div className="p-2.5 rounded bg-surface-base border border-accent-steel/40 space-y-2 mt-2 animate-fadeIn">
          <div className="flex items-center justify-between text-[11px] font-mono text-accent-steel">
            <span className="flex items-center space-x-1">
              <BookOpen className="h-3 w-3 inline" />
              <span>Register Custom Terminology Pair</span>
            </span>
            <button
              type="button"
              onClick={() => setShowGlossaryInput(false)}
              className="text-text-muted hover:text-text-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <input
              type="text"
              placeholder="Source term..."
              value={sourceTerm}
              onChange={(e) => setSourceTerm(e.target.value)}
              className="px-2 py-1 bg-surface-panel border border-surface-border rounded text-text-primary outline-none focus:border-accent-steel text-xs font-mono"
            />
            <input
              type="text"
              placeholder="Target translation..."
              value={targetTerm}
              onChange={(e) => setTargetTerm(e.target.value)}
              className="px-2 py-1 bg-surface-panel border border-surface-border rounded text-text-primary outline-none focus:border-accent-steel text-xs font-mono"
            />
          </div>
          <div className="flex justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setShowGlossaryInput(false)}
              className="px-2 py-0.5 rounded text-[11px] text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveGlossaryTerm}
              className="px-2.5 py-0.5 rounded text-[11px] bg-accent-steel text-white font-semibold hover:bg-accent-steel/80"
            >
              Save Term
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
