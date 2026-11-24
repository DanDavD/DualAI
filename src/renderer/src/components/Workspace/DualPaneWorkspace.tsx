/**
 * DUALAI - Zone 3 Dual-Pane Split Workspace & Virtualized Feed
 * Synchronized 50/50 resizable split interface with persistent width memory,
 * high-contrast critical entity highlighting, inline action rail, smart auto-scroll,
 * and virtualized windowing supporting 1,000+ utterances without frame drops.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Activity,
  ShieldCheck,
  Layers,
  ArrowDownCircle,
  Trash2,
  Filter,
  CheckCircle2,
  Radio,
  SlidersHorizontal,
  BookmarkCheck
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { SplitDivider } from './SplitDivider'
import { UtteranceCard } from './UtteranceCard'
import { TranslationCard } from './TranslationCard'
import { TranscriptUtterance } from '../../../../types/stt'
import { TranslationResult } from '../../../../types/translation'

const ESTIMATED_ITEM_HEIGHT = 120
const OVERSCAN_COUNT = 5
const STORAGE_KEY_SPLIT = 'dualai_workspace_split_ratio'

export const DualPaneWorkspace: React.FC = () => {
  const {
    sourceLang,
    targetLang,
    domainId,
    isAudioActive,
    startAudioEngine,
    stopAudioEngine,
    utterances,
    interimTranscriptA,
    interimTranscriptB,
    translations,
    activeTranslation,
    clearTranscripts,
    triggerDomainTestTranslation,
    addGlossaryEntry
  } = useSession()

  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 1. Resizable Split Ratio with Persistent Width Memory
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SPLIT)
      if (saved) {
        const parsed = parseFloat(saved)
        if (!isNaN(parsed) && parsed >= 25 && parsed <= 75) {
          return parsed
        }
      }
    } catch {
      // Fallback to 50%
    }
    return 50
  })

  const handleSplitCommit = useCallback((finalRatio: number) => {
    try {
      localStorage.setItem(STORAGE_KEY_SPLIT, finalRatio.toString())
    } catch {
      // Ignore storage errors in restricted sandboxes
    }
  }, [])

  // 2. Speaker Labels & Flagged Utterances State
  const [speakerOverrides, setSpeakerOverrides] = useState<Record<string, string>>({})
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())
  const [filterFlaggedOnly, setFilterFlaggedOnly] = useState(false)
  const [glossaryNotification, setGlossaryNotification] = useState<string | null>(null)

  const handleUpdateSpeakerLabel = useCallback((utteranceId: string, newLabel: string) => {
    setSpeakerOverrides((prev) => ({ ...prev, [utteranceId]: newLabel }))
  }, [])

  const handleToggleFlag = useCallback((utteranceId: string) => {
    setFlaggedIds((prev) => {
      const next = new Set(prev)
      if (next.has(utteranceId)) {
        next.delete(utteranceId)
      } else {
        next.add(utteranceId)
      }
      return next
    })
  }, [])

  const handleAddToGlossary = useCallback(
    (sourceTerm: string, targetTerm: string) => {
      addGlossaryEntry(sourceTerm, targetTerm)
      setGlossaryNotification(`Injected "${sourceTerm}" -> "${targetTerm}" into prompt glossary`)
      setTimeout(() => setGlossaryNotification(null), 3000)
    },
    [addGlossaryEntry]
  )

  // 3. Paired Dialogue List Assembly
  const pairedItems = useMemo(() => {
    const translationMap = new Map<string, TranslationResult>()
    translations.forEach((t) => {
      translationMap.set(t.utteranceId, t)
    })

    const items = utterances.map((u) => {
      const effectiveUtterance = speakerOverrides[u.id]
        ? { ...u, speakerLabel: speakerOverrides[u.id] }
        : u
      return {
        id: u.id,
        utterance: effectiveUtterance,
        translation: translationMap.get(u.id),
        isFlagged: flaggedIds.has(u.id)
      }
    })

    if (filterFlaggedOnly) {
      return items.filter((item) => item.isFlagged)
    }

    return items
  }, [utterances, translations, speakerOverrides, flaggedIds, filterFlaggedOnly])

  // 4. Virtualized Windowing Engine (Supports 1,000+ items smoothly)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  // 5. Smart Auto-Scroll Behavior
  const [isAutoScrollActive, setIsAutoScrollActive] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const prevItemsLengthRef = useRef(pairedItems.length)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const currentScrollTop = target.scrollTop
    setScrollTop(currentScrollTop)

    const distanceFromBottom = target.scrollHeight - currentScrollTop - target.clientHeight
    const isAtBottom = distanceFromBottom <= 40

    if (isAtBottom) {
      setIsAutoScrollActive(true)
      setUnreadCount(0)
    } else {
      setIsAutoScrollActive(false)
    }
  }

  // Update viewport measurement on resize
  useEffect(() => {
    if (!scrollContainerRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
      }
    })
    ro.observe(scrollContainerRef.current)
    return () => ro.disconnect()
  }, [])

  // Handle incoming items and auto-scroll
  useEffect(() => {
    const hasNewItems = pairedItems.length > prevItemsLengthRef.current
    prevItemsLengthRef.current = pairedItems.length

    if (!scrollContainerRef.current) return

    if (isAutoScrollActive) {
      // Smoothly stick to bottom
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
        }
      })
    } else if (hasNewItems) {
      setUnreadCount((prev) => prev + 1)
    }
  }, [pairedItems, activeTranslation, interimTranscriptA, interimTranscriptB, isAutoScrollActive])

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      })
      setIsAutoScrollActive(true)
      setUnreadCount(0)
    }
  }, [])

  // Calculate visible virtualization range
  const totalItems = pairedItems.length
  const startIndex = Math.max(0, Math.floor(scrollTop / ESTIMATED_ITEM_HEIGHT) - OVERSCAN_COUNT)
  const visibleCount = Math.ceil(viewportHeight / ESTIMATED_ITEM_HEIGHT) + 2 * OVERSCAN_COUNT
  const endIndex = Math.min(totalItems, startIndex + visibleCount)

  const topSpacerHeight = startIndex * ESTIMATED_ITEM_HEIGHT
  const bottomSpacerHeight = Math.max(0, (totalItems - endIndex) * ESTIMATED_ITEM_HEIGHT)
  const visibleItems = pairedItems.slice(startIndex, endIndex)

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col h-full bg-surface-base text-text-primary overflow-hidden font-sans"
    >
      {/* Workspace Sub-Toolbar: Controls & Filters */}
      <div className="flex h-10 items-center justify-between border-b border-surface-border bg-surface-panel px-4 text-xs font-mono select-none">
        {/* Left Controls: Test Injection & Audio Ingestion Status */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={isAudioActive ? stopAudioEngine : startAudioEngine}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded font-bold border transition ${
              isAudioActive
                ? 'bg-accent-crimson/15 text-accent-crimson border-accent-crimson/30 hover:bg-accent-crimson/25'
                : 'bg-accent-emerald/15 text-accent-emerald border-accent-emerald/30 hover:bg-accent-emerald/25'
            }`}
          >
            <Radio className="h-3 w-3" strokeWidth={2} />
            <span>{isAudioActive ? 'STOP CAPTURE' : 'START AUDIO CAPTURE'}</span>
          </button>

          <span className="text-surface-border">|</span>

          {/* Quick Domain Test Triggers */}
          <span className="text-text-muted text-[11px]">Inject Domain:</span>
          <button
            type="button"
            onClick={() => triggerDomainTestTranslation('medical')}
            className="px-2 py-0.5 rounded bg-surface-base border border-surface-border hover:border-accent-emerald/50 hover:text-accent-emerald text-text-secondary transition flex items-center space-x-1 text-[11px]"
            title="Inject clinical utterance with ICD-10 anatomical directives"
          >
            <Activity className="h-2.5 w-2.5 text-accent-emerald" />
            <span>Medical</span>
          </button>
          <button
            type="button"
            onClick={() => triggerDomainTestTranslation('legal')}
            className="px-2 py-0.5 rounded bg-surface-base border border-surface-border hover:border-accent-steel/50 hover:text-accent-steel text-text-secondary transition flex items-center space-x-1 text-[11px]"
            title="Inject courtroom utterance with verbatim legal terms"
          >
            <ShieldCheck className="h-2.5 w-2.5 text-accent-steel" />
            <span>Legal</span>
          </button>
          <button
            type="button"
            onClick={() => triggerDomainTestTranslation('technical')}
            className="px-2 py-0.5 rounded bg-surface-base border border-surface-border hover:border-accent-amber/50 hover:text-accent-amber text-text-secondary transition flex items-center space-x-1 text-[11px]"
            title="Inject software engineering utterance"
          >
            <Layers className="h-2.5 w-2.5 text-accent-amber" />
            <span>Tech</span>
          </button>
        </div>

        {/* Right Controls: Filters & Actions */}
        <div className="flex items-center space-x-3">
          {/* Flagged Filter Toggle */}
          <button
            type="button"
            onClick={() => setFilterFlaggedOnly(!filterFlaggedOnly)}
            className={`flex items-center space-x-1 px-2 py-1 rounded border transition ${
              filterFlaggedOnly
                ? 'bg-accent-amber/20 text-accent-amber border-accent-amber/50 font-bold'
                : 'bg-surface-base text-text-secondary border-surface-border hover:text-text-primary'
            }`}
            title="Filter feed to show only flagged items"
          >
            <Filter className="h-3 w-3" />
            <span>Flagged ({flaggedIds.size})</span>
          </button>

          {/* Clear Feed */}
          <button
            type="button"
            onClick={clearTranscripts}
            disabled={pairedItems.length === 0}
            className="text-text-muted hover:text-accent-crimson disabled:opacity-40 transition flex items-center space-x-1"
            title="Clear all transcripts and translations"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear Feed</span>
          </button>
        </div>
      </div>

      {/* Pane Column Headers */}
      <div className="flex border-b border-surface-border bg-surface-base text-[11px] font-mono text-text-secondary select-none">
        {/* Left Pane Header */}
        <div
          style={{ width: `${splitRatio}%` }}
          className="flex items-center justify-between px-4 py-2 border-r border-surface-border"
        >
          <div className="flex items-center space-x-2">
            <span className="font-bold text-text-primary uppercase tracking-wider">
              Original Speech Feed (Source)
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface-panel border border-surface-border text-accent-steel font-bold">
              {sourceLang.toUpperCase()}
            </span>
          </div>
          <span className="text-text-muted">
            {pairedItems.length} {pairedItems.length === 1 ? 'utterance' : 'utterances'}
          </span>
        </div>

        {/* Right Pane Header */}
        <div
          style={{ width: `${100 - splitRatio}%` }}
          className="flex items-center justify-between px-4 py-2"
        >
          <div className="flex items-center space-x-2">
            <span className="font-bold text-text-primary uppercase tracking-wider">
              Simultaneous Translation Feed (Target)
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface-panel border border-surface-border text-accent-emerald font-bold">
              {targetLang.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center space-x-1.5 text-text-muted text-[10px]">
            <span>Split: {Math.round(splitRatio)}% / {100 - Math.round(splitRatio)}%</span>
          </div>
        </div>
      </div>

      {/* Synchronized Virtualized Workspace Feed Body */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full w-full overflow-y-auto relative"
        >
          {/* Top Virtual Spacer */}
          {topSpacerHeight > 0 && <div style={{ height: `${topSpacerHeight}px` }} />}

          {/* Virtualized Visible Item Rows */}
          {visibleItems.map((item) => (
            <div
              key={item.id}
              className="flex border-b border-surface-border-subtle hover:bg-surface-active/30 transition-colors"
            >
              {/* Left Pane Item Column */}
              <div
                style={{ width: `${splitRatio}%` }}
                className="p-3 border-r border-surface-border flex flex-col justify-start"
              >
                <UtteranceCard
                  utterance={item.utterance}
                  isInterim={false}
                  isFlagged={item.isFlagged}
                  sourceLang={sourceLang}
                  onUpdateSpeakerLabel={handleUpdateSpeakerLabel}
                />
              </div>

              {/* Central Divider Placeholder alignment */}
              <div className="w-0 relative" />

              {/* Right Pane Item Column */}
              <div
                style={{ width: `${100 - splitRatio}%` }}
                className="p-3 flex flex-col justify-start"
              >
                <TranslationCard
                  translation={item.translation}
                  utteranceId={item.id}
                  isStreaming={false}
                  isFlagged={item.isFlagged}
                  targetLang={targetLang}
                  onToggleFlag={handleToggleFlag}
                  onAddToGlossary={handleAddToGlossary}
                />
              </div>
            </div>
          ))}

          {/* Active Interim Streaming Speech (Pinned to Bottom of List) */}
          {(interimTranscriptA || interimTranscriptB || activeTranslation) && (
            <div className="flex border-b border-surface-border-subtle bg-surface-active/20 animate-fadeIn">
              {/* Left Column Interim Speech */}
              <div style={{ width: `${splitRatio}%` }} className="p-3 border-r border-surface-border">
                {interimTranscriptA && (
                  <UtteranceCard
                    utterance={interimTranscriptA}
                    isInterim={true}
                    sourceLang={sourceLang}
                    onUpdateSpeakerLabel={handleUpdateSpeakerLabel}
                  />
                )}
                {interimTranscriptB && (
                  <UtteranceCard
                    utterance={interimTranscriptB}
                    isInterim={true}
                    sourceLang={targetLang}
                    onUpdateSpeakerLabel={handleUpdateSpeakerLabel}
                  />
                )}
              </div>

              {/* Right Column Streaming Translation */}
              <div style={{ width: `${100 - splitRatio}%` }} className="p-3">
                {activeTranslation && (
                  <TranslationCard
                    translation={activeTranslation}
                    utteranceId={activeTranslation.utteranceId}
                    isStreaming={true}
                    targetLang={targetLang}
                    onToggleFlag={handleToggleFlag}
                    onAddToGlossary={handleAddToGlossary}
                  />
                )}
              </div>
            </div>
          )}

          {/* Bottom Virtual Spacer */}
          {bottomSpacerHeight > 0 && <div style={{ height: `${bottomSpacerHeight}px` }} />}

          {/* Empty State */}
          {pairedItems.length === 0 && !interimTranscriptA && !interimTranscriptB && !activeTranslation && (
            <div className="flex flex-col items-center justify-center h-full p-12 text-center text-text-muted space-y-3">
              <SlidersHorizontal className="h-8 w-8 text-surface-border" strokeWidth={1.5} />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-text-secondary font-mono">
                  Zone 3 Dual Workspace Ready
                </p>
                <p className="text-xs text-text-muted max-w-md">
                  Click <strong className="text-accent-emerald">"START AUDIO CAPTURE"</strong> or use the test domain triggers above (Medical, Legal, Tech) to render synchronized transcripts.
                </p>
              </div>
              <p className="text-[11px] font-mono text-text-muted pt-2 border-t border-surface-border-subtle">
                Drag the central divider to adjust split width (persisted in localStorage). Numbers and medical units are highlighted in high-contrast bold.
              </p>
            </div>
          )}
        </div>

        {/* Floating Draggable Split Divider Line Overlay */}
        <div
          style={{ left: `${splitRatio}%` }}
          className="absolute top-0 bottom-0 pointer-events-auto"
        >
          <SplitDivider
            splitRatio={splitRatio}
            onSplitChange={setSplitRatio}
            onSplitCommit={handleSplitCommit}
            containerRef={containerRef}
          />
        </div>

        {/* Floating Smart Auto-Scroll Resume Badge */}
        {!isAutoScrollActive && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
            <button
              type="button"
              onClick={scrollToBottom}
              className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-surface-panel border border-accent-steel text-text-primary shadow-lg text-xs font-mono font-medium hover:bg-surface-active transition-transform active:scale-95"
            >
              <ArrowDownCircle className="h-3.5 w-3.5 text-accent-steel animate-bounce" />
              <span>
                Auto-scroll paused{unreadCount > 0 ? ` (${unreadCount} new)` : ''} - Resume
              </span>
            </button>
          </div>
        )}

        {/* Temporary Glossary Saved Toast Notification */}
        {glossaryNotification && (
          <div className="absolute top-4 right-4 z-40 animate-slideDown">
            <div className="flex items-center space-x-2 px-3 py-2 rounded bg-surface-panel border border-accent-emerald text-accent-emerald text-xs font-mono shadow-md">
              <BookmarkCheck className="h-4 w-4" />
              <span>{glossaryNotification}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
