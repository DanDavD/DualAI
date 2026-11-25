/**
 * DUALAI - Zone 3 Clean Boxless Dual-Pane Split Workspace (CARD-15)
 * Maximizes vertical reading real estate with zero developer test clutter,
 * calm borderless flowing transcript rows, persistent scrollable history
 * (phone numbers, emails, clinical figures remain accessible), smart auto-scroll,
 * and a clear plain-English audio source picker when idle.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ArrowDownCircle,
  Filter,
  CheckCircle2,
  Mic,
  Volume2,
  ArrowRightLeft,
  AppWindow,
  MessageSquare
} from 'lucide-react'
import { AudioRouteMode } from '../../../../types/audio'
import { SUPPORTED_LANGUAGES } from '../../../../types/language'
import { useSession } from '../../context/SessionContext'
import { SplitDivider } from './SplitDivider'
import { UtteranceCard } from './UtteranceCard'
import { TranslationCard } from './TranslationCard'
import { TranslationResult } from '../../../../types/translation'
import {
  resolveAudioRoutingPolicy,
  resolveTranslationTargetForChannel
} from '../../audio/audioRoutingPolicy'
import {
  resolveLineSpacingMetrics,
  resolveTurnPaneColors
} from '../../utils/typographyPreferences'

const ESTIMATED_ITEM_HEIGHT = 84
const OVERSCAN_COUNT = 6
const STORAGE_KEY_SPLIT = 'dualai_workspace_split_ratio'

const EMPTY_STATE_ROUTES: Array<{
  id: AudioRouteMode
  title: string
  subtitle: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}> = [
  {
    id: 'mic',
    title: 'Microphone',
    subtitle: 'Capture your voice directly through your microphone',
    icon: Mic
  },
  {
    id: 'system',
    title: 'System Audio',
    subtitle: 'Capture audio from videos, browser tabs, Zoom, or Teams',
    icon: Volume2
  },
  {
    id: 'bilateral',
    title: 'Microphone and system audio',
    subtitle: 'Your voice on the mic plus the other person from system audio',
    icon: ArrowRightLeft
  },
  {
    id: 'app',
    title: 'Audio from one app',
    subtitle: 'Focus capture on a single video call or browser session',
    icon: AppWindow
  }
]

function getLanguageDisplay(code: string): string {
  const found = SUPPORTED_LANGUAGES.find((l) => l.code === code)
  return found ? found.nativeName : code.toUpperCase()
}

export const DualPaneWorkspace: React.FC = () => {
  const {
    audioRoute,
    setAudioRoute,
    operatingMode,
    setOperatingMode,
    latencyMode,
    sourceLang,
    targetLang,
    loopbackStatus,
    loopbackStatusMessage,
    pipelineErrorMessage,
    openSettingsModal,
    utterances,
    interimTranscriptA,
    interimTranscriptB,
    translations,
    streamingTranslations,
    draftTranslationA,
    draftTranslationB,
    activeTranslation,
    workspaceDisplaySettings,
    addGlossaryEntry
  } = useSession()

  const containerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const routingDecision = useMemo(
    () =>
      resolveAudioRoutingPolicy({
        audioRoute,
        operatingMode,
        sourceLang,
        targetLang
      }),
    [audioRoute, operatingMode, sourceLang, targetLang]
  )

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
      setGlossaryNotification(`Added "${sourceTerm}" -> "${targetTerm}" to custom glossary`)
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
      const effectiveTarget = resolveTranslationTargetForChannel(u.channelId, routingDecision)
      const finalTranslation = translationMap.get(u.id)
      const inFlightTranslation = streamingTranslations[u.id]
      const effectiveTranslation = finalTranslation || inFlightTranslation
      const isRowStreaming = !finalTranslation && Boolean(inFlightTranslation)

      const { originalColor, translationColor } = resolveTurnPaneColors({
        spokenLang: u.language || effectiveTranslation?.sourceLang || sourceLang,
        translatedLang: effectiveTranslation?.targetLang,
        sourceLang,
        targetLang,
        operatingMode,
        settings: workspaceDisplaySettings
      })

      return {
        id: u.id,
        utterance: effectiveUtterance,
        translation: effectiveTranslation,
        isRowStreaming,
        isFlagged: flaggedIds.has(u.id),
        effectiveTarget,
        originalColor,
        translationColor
      }
    })

    if (filterFlaggedOnly) {
      return items.filter((item) => item.isFlagged)
    }
    return items
  }, [
    utterances,
    translations,
    streamingTranslations,
    speakerOverrides,
    flaggedIds,
    filterFlaggedOnly,
    routingDecision,
    sourceLang,
    targetLang,
    operatingMode,
    workspaceDisplaySettings
  ])

  // 4. Smart Auto-Scroll & Virtualization State
  const [isAutoScrollActive, setIsAutoScrollActive] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const prevItemsLengthRef = useRef(pairedItems.length)

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return

    setScrollTop(el.scrollTop)

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isAtBottom = distanceFromBottom <= 36

    if (isAtBottom) {
      if (!isAutoScrollActive) {
        setIsAutoScrollActive(true)
        setUnreadCount(0)
      }
    } else if (isAutoScrollActive) {
      setIsAutoScrollActive(false)
    }
  }, [isAutoScrollActive])

  useEffect(() => {
    const hasNewItems = pairedItems.length > prevItemsLengthRef.current
    prevItemsLengthRef.current = pairedItems.length

    if (isAutoScrollActive && scrollContainerRef.current) {
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
        }
      })
    } else if (hasNewItems) {
      setUnreadCount((prev) => prev + 1)
    }
  }, [
    pairedItems,
    activeTranslation,
    streamingTranslations,
    draftTranslationA,
    draftTranslationB,
    interimTranscriptA,
    interimTranscriptB,
    isAutoScrollActive
  ])

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

  const lineMetrics = resolveLineSpacingMetrics(workspaceDisplaySettings.lineSpacing)
  const viewMode = workspaceDisplaySettings.viewMode
  const isDualView = viewMode === 'dual'
  const isTargetOnlyView = viewMode === 'target_only'
  const isStackedView = viewMode === 'stacked'
  const rowPaddingClass = lineMetrics.rowPaddingClass
  const dividerBorderClass = workspaceDisplaySettings.highContrast
    ? 'border-surface-border'
    : 'border-surface-border/60'

  // Dynamic virtualization item height scales cleanly with Font Size, Line Spacing & Linear Cascade
  const effectiveItemHeight = Math.round(
    ESTIMATED_ITEM_HEIGHT *
      (workspaceDisplaySettings.fontSizePx / 15) *
      (isTargetOnlyView ? 1 : 1.55) *
      (workspaceDisplaySettings.lineSpacing === 'relaxed'
        ? 1.18
        : workspaceDisplaySettings.lineSpacing === 'compact'
          ? 0.85
          : 1)
  )

  // Virtualized visible window
  const totalItems = pairedItems.length
  const startIndex = Math.max(0, Math.floor(scrollTop / effectiveItemHeight) - OVERSCAN_COUNT)
  const visibleCount = Math.ceil(viewportHeight / effectiveItemHeight) + 2 * OVERSCAN_COUNT
  const endIndex = Math.min(totalItems, startIndex + visibleCount)

  const topSpacerHeight = startIndex * effectiveItemHeight
  const bottomSpacerHeight = Math.max(0, (totalItems - endIndex) * effectiveItemHeight)
  const visibleItems = pairedItems.slice(startIndex, endIndex)

  const hasLiveContent =
    pairedItems.length > 0 ||
    Boolean(interimTranscriptA) ||
    Boolean(interimTranscriptB) ||
    Boolean(draftTranslationA) ||
    Boolean(draftTranslationB) ||
    Boolean(activeTranslation)

  const sourceDisplayName = getLanguageDisplay(sourceLang)
  const targetDisplayName = getLanguageDisplay(targetLang)
  const isLiveMode = latencyMode === 'sub_second_live'

  const renderFlagFilterPill = () =>
    flaggedIds.size > 0 ? (
      <button
        type="button"
        onClick={() => setFilterFlaggedOnly(!filterFlaggedOnly)}
        className={`flex items-center space-x-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] transition ${
          filterFlaggedOnly
            ? 'border-accent-amber bg-accent-amber/20 text-accent-amber font-semibold'
            : 'border-surface-border bg-surface-panel text-text-secondary hover:text-text-primary'
        }`}
        title="Filter feed to show only flagged items"
      >
        <Filter className="h-3 w-3" />
        <span>
          {filterFlaggedOnly ? `Showing ${flaggedIds.size} Flagged` : `Flagged (${flaggedIds.size})`}
        </span>
      </button>
    ) : null

  return (
    <div
      ref={containerRef}
      className="relative flex-1 flex flex-col h-full bg-surface-base text-text-primary overflow-hidden font-sans"
    >
      {/* Actionable System Audio Loopback / Pipeline Error Banner (Shown Only On Error) */}
      {(pipelineErrorMessage || loopbackStatus === 'unavailable') && (
        <div
          role="alert"
          className="flex items-center justify-between border-b border-accent-crimson/40 bg-accent-crimson/10 px-4 py-2 font-mono text-[11px] text-text-primary shrink-0"
        >
          <span className="truncate pr-3">
            <strong className="text-accent-crimson uppercase mr-2">Notice:</strong>
            {pipelineErrorMessage || loopbackStatusMessage}
          </span>
          <button
            type="button"
            onClick={openSettingsModal}
            className="shrink-0 rounded border border-accent-crimson/50 bg-surface-panel px-2.5 py-1 text-[10px] font-bold text-text-primary hover:bg-surface-active transition"
          >
            Audio Settings
          </button>
        </div>
      )}

      {/* Clean Functional Pane Indicator Bar: Original (Left) | Translation (Right) */}
      <div className={`flex h-8 w-full shrink-0 items-center border-b ${dividerBorderClass} bg-surface-base select-none`}>
        {isDualView ? (
          <>
            <div
              style={{ width: `${splitRatio}%` }}
              className={`flex h-full items-center space-x-2 border-r ${dividerBorderClass} px-6`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent-steel shrink-0" />
              <span className="text-xs font-medium text-text-secondary tracking-wide truncate">
                Original
              </span>
            </div>
            <div
              style={{ width: `${100 - splitRatio}%` }}
              className="flex h-full items-center justify-between px-6"
            >
              <div className="flex items-center space-x-2 min-w-0">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald shrink-0" />
                <span className="text-xs font-medium text-text-secondary tracking-wide truncate">
                  Translation
                </span>
              </div>
              {renderFlagFilterPill()}
            </div>
          </>
        ) : isTargetOnlyView ? (
          <div className="flex h-full w-full items-center justify-between px-6">
            <div className="flex items-center space-x-2 min-w-0">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald shrink-0" />
              <span className="text-xs font-medium text-text-secondary tracking-wide truncate">
                Translation
              </span>
            </div>
            {renderFlagFilterPill()}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-between px-6">
            <div className="flex items-center space-x-2 min-w-0">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-steel shrink-0" />
              <span className="text-xs font-medium text-text-secondary tracking-wide truncate">
                Original {'->'} Translation
              </span>
            </div>
            {renderFlagFilterPill()}
          </div>
        )}
      </div>

      {/* Synchronized Boxless Transcript Canvas (Non-Selectable, 60fps Fluid Scroll) */}
      <div className="relative flex-1 overflow-hidden select-none">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full w-full overflow-y-auto relative"
        >
          {hasLiveContent ? (
            <div className="min-h-full py-3">
              {/* Top Virtual Spacer */}
              {topSpacerHeight > 0 && <div style={{ height: `${topSpacerHeight}px` }} />}

              {/* Flowing, Boxless Paired Paragraph Rows */}
              {visibleItems.map((item) => {
                if (isTargetOnlyView) {
                  return (
                    <div
                      key={item.id}
                      className={`px-8 ${rowPaddingClass} hover:bg-surface-panel/40 transition-colors max-w-5xl mx-auto`}
                    >
                      <TranslationCard
                        translation={item.translation}
                        utteranceId={item.id}
                        isStreaming={item.isRowStreaming}
                        isDraft={false}
                        isFlagged={item.isFlagged}
                        textColor={item.translationColor}
                        displaySettings={workspaceDisplaySettings}
                        onToggleFlag={handleToggleFlag}
                        onAddToGlossary={handleAddToGlossary}
                      />
                    </div>
                  )
                }

                if (isStackedView) {
                  return (
                    <div
                      key={item.id}
                      className={`px-6 ${rowPaddingClass} border-b border-surface-border-subtle/60 hover:bg-surface-panel/40 transition-colors space-y-1 max-w-4xl mx-auto`}
                    >
                      <UtteranceCard
                        utterance={item.utterance}
                        isInterim={false}
                        isFlagged={item.isFlagged}
                        isStacked={true}
                        textColor={item.originalColor}
                        displaySettings={workspaceDisplaySettings}
                        onUpdateSpeakerLabel={handleUpdateSpeakerLabel}
                      />
                      <TranslationCard
                        translation={item.translation}
                        utteranceId={item.id}
                        isStreaming={item.isRowStreaming}
                        isDraft={false}
                        isFlagged={item.isFlagged}
                        textColor={item.translationColor}
                        displaySettings={workspaceDisplaySettings}
                        onToggleFlag={handleToggleFlag}
                        onAddToGlossary={handleAddToGlossary}
                      />
                    </div>
                  )
                }

                return (
                  <div
                    key={item.id}
                    className="border-b border-surface-border-subtle/40 hover:bg-surface-panel/30 transition-colors"
                  >
                    {/* Step 1: Original Speech (Left Pane) */}
                    <div className="flex">
                      <div
                        style={{ width: `${splitRatio}%` }}
                        className={`px-6 pt-3 pb-1 border-r ${dividerBorderClass}`}
                      >
                        <UtteranceCard
                          utterance={item.utterance}
                          isInterim={false}
                          isFlagged={item.isFlagged}
                          textColor={item.originalColor}
                          displaySettings={workspaceDisplaySettings}
                          onUpdateSpeakerLabel={handleUpdateSpeakerLabel}
                        />
                      </div>
                      <div style={{ width: `${100 - splitRatio}%` }} className="px-6 pt-3 pb-1" />
                    </div>

                    {/* Step 2: Translation Placed One Step Below (Right Pane — Linear Timeline Flow) */}
                    <div className="flex">
                      <div
                        style={{ width: `${splitRatio}%` }}
                        className={`px-6 pt-1 pb-3 border-r ${dividerBorderClass}`}
                      />
                      <div
                        style={{ width: `${100 - splitRatio}%` }}
                        className="px-6 pt-1 pb-3"
                      >
                        <TranslationCard
                          translation={item.translation}
                          utteranceId={item.id}
                          isStreaming={item.isRowStreaming}
                          isDraft={false}
                          isFlagged={item.isFlagged}
                          textColor={item.translationColor}
                          displaySettings={workspaceDisplaySettings}
                          onToggleFlag={handleToggleFlag}
                          onAddToGlossary={handleAddToGlossary}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Active Channel A In-Progress Paragraph Row */}
              {(interimTranscriptA || draftTranslationA) &&
                (() => {
                  const {
                    originalColor: draftOriginalColorA,
                    translationColor: draftTranslationColorA
                  } = resolveTurnPaneColors({
                    spokenLang:
                      interimTranscriptA?.language || draftTranslationA?.sourceLang || sourceLang,
                    translatedLang: draftTranslationA?.targetLang,
                    sourceLang,
                    targetLang,
                    operatingMode,
                    settings: workspaceDisplaySettings
                  })

                  if (isTargetOnlyView) {
                    return (
                      <div className={`px-8 ${rowPaddingClass} bg-surface-panel/25 max-w-5xl mx-auto`}>
                        {isLiveMode ? (
                          <TranslationCard
                            translation={draftTranslationA || undefined}
                            utteranceId={
                              draftTranslationA?.utteranceId ||
                              interimTranscriptA?.id ||
                              'draft-channel-a'
                            }
                            isStreaming={draftTranslationA ? draftTranslationA.isStreaming : true}
                            isDraft={true}
                            textColor={draftTranslationColorA}
                            displaySettings={workspaceDisplaySettings}
                            onToggleFlag={handleToggleFlag}
                            onAddToGlossary={handleAddToGlossary}
                          />
                        ) : (
                          <TranslationCard
                            utteranceId={interimTranscriptA?.id || 'accurate-channel-a'}
                            isWaitingForPause={true}
                            isDraft={true}
                            textColor={draftTranslationColorA}
                            displaySettings={workspaceDisplaySettings}
                            onToggleFlag={handleToggleFlag}
                            onAddToGlossary={handleAddToGlossary}
                          />
                        )}
                      </div>
                    )
                  }

                  if (isStackedView) {
                    return (
                      <div className={`px-6 ${rowPaddingClass} bg-surface-panel/25 space-y-1 max-w-4xl mx-auto`}>
                        {interimTranscriptA && (
                          <UtteranceCard
                            utterance={interimTranscriptA}
                            isInterim={true}
                            isStacked={true}
                            textColor={draftOriginalColorA}
                            displaySettings={workspaceDisplaySettings}
                            onUpdateSpeakerLabel={handleUpdateSpeakerLabel}
                          />
                        )}
                        {isLiveMode ? (
                          <TranslationCard
                            translation={draftTranslationA || undefined}
                            utteranceId={
                              draftTranslationA?.utteranceId ||
                              interimTranscriptA?.id ||
                              'draft-channel-a'
                            }
                            isStreaming={draftTranslationA ? draftTranslationA.isStreaming : true}
                            isDraft={true}
                            textColor={draftTranslationColorA}
                            displaySettings={workspaceDisplaySettings}
                            onToggleFlag={handleToggleFlag}
                            onAddToGlossary={handleAddToGlossary}
                          />
                        ) : (
                          <TranslationCard
                            utteranceId={interimTranscriptA?.id || 'accurate-channel-a'}
                            isWaitingForPause={true}
                            isDraft={true}
                            textColor={draftTranslationColorA}
                            displaySettings={workspaceDisplaySettings}
                            onToggleFlag={handleToggleFlag}
                            onAddToGlossary={handleAddToGlossary}
                          />
                        )}
                      </div>
                    )
                  }

                  return (
                    <div className="bg-surface-panel/20">
                      <div className="flex">
                        <div
                          style={{ width: `${splitRatio}%` }}
                          className={`px-6 pt-3 pb-1 border-r ${dividerBorderClass}`}
                        >
                          {interimTranscriptA && (
                            <UtteranceCard
                              utterance={interimTranscriptA}
                              isInterim={true}
                              textColor={draftOriginalColorA}
                              displaySettings={workspaceDisplaySettings}
                              onUpdateSpeakerLabel={handleUpdateSpeakerLabel}
                            />
                          )}
                        </div>
                        <div style={{ width: `${100 - splitRatio}%` }} className="px-6 pt-3 pb-1" />
                      </div>

                      <div className="flex">
                        <div
                          style={{ width: `${splitRatio}%` }}
                          className={`px-6 pt-1 pb-3 border-r ${dividerBorderClass}`}
                        />
                        <div style={{ width: `${100 - splitRatio}%` }} className="px-6 pt-1 pb-3">
                          {isLiveMode ? (
                            <TranslationCard
                              translation={draftTranslationA || undefined}
                              utteranceId={
                                draftTranslationA?.utteranceId ||
                                interimTranscriptA?.id ||
                                'draft-channel-a'
                              }
                              isStreaming={draftTranslationA ? draftTranslationA.isStreaming : true}
                              isDraft={true}
                              textColor={draftTranslationColorA}
                              displaySettings={workspaceDisplaySettings}
                              onToggleFlag={handleToggleFlag}
                              onAddToGlossary={handleAddToGlossary}
                            />
                          ) : (
                            <TranslationCard
                              utteranceId={interimTranscriptA?.id || 'accurate-channel-a'}
                              isWaitingForPause={true}
                              isDraft={true}
                              textColor={draftTranslationColorA}
                              displaySettings={workspaceDisplaySettings}
                              onToggleFlag={handleToggleFlag}
                              onAddToGlossary={handleAddToGlossary}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}

              {/* Active Channel B In-Progress Paragraph Row */}
              {(interimTranscriptB || draftTranslationB) &&
                (() => {
                  const {
                    originalColor: draftOriginalColorB,
                    translationColor: draftTranslationColorB
                  } = resolveTurnPaneColors({
                    spokenLang:
                      interimTranscriptB?.language || draftTranslationB?.sourceLang || sourceLang,
                    translatedLang: draftTranslationB?.targetLang,
                    sourceLang,
                    targetLang,
                    operatingMode,
                    settings: workspaceDisplaySettings
                  })

                  if (isTargetOnlyView) {
                    return (
                      <div className={`px-8 ${rowPaddingClass} bg-surface-panel/25 max-w-5xl mx-auto`}>
                        {isLiveMode ? (
                          <TranslationCard
                            translation={draftTranslationB || undefined}
                            utteranceId={
                              draftTranslationB?.utteranceId ||
                              interimTranscriptB?.id ||
                              'draft-channel-b'
                            }
                            isStreaming={draftTranslationB ? draftTranslationB.isStreaming : true}
                            isDraft={true}
                            textColor={draftTranslationColorB}
                            displaySettings={workspaceDisplaySettings}
                            onToggleFlag={handleToggleFlag}
                            onAddToGlossary={handleAddToGlossary}
                          />
                        ) : (
                          <TranslationCard
                            utteranceId={interimTranscriptB?.id || 'accurate-channel-b'}
                            isWaitingForPause={true}
                            isDraft={true}
                            textColor={draftTranslationColorB}
                            displaySettings={workspaceDisplaySettings}
                            onToggleFlag={handleToggleFlag}
                            onAddToGlossary={handleAddToGlossary}
                          />
                        )}
                      </div>
                    )
                  }

                  if (isStackedView) {
                    return (
                      <div className={`px-6 ${rowPaddingClass} bg-surface-panel/25 space-y-1 max-w-4xl mx-auto`}>
                        {interimTranscriptB && (
                          <UtteranceCard
                            utterance={interimTranscriptB}
                            isInterim={true}
                            isStacked={true}
                            textColor={draftOriginalColorB}
                            displaySettings={workspaceDisplaySettings}
                            onUpdateSpeakerLabel={handleUpdateSpeakerLabel}
                          />
                        )}
                        {isLiveMode ? (
                          <TranslationCard
                            translation={draftTranslationB || undefined}
                            utteranceId={
                              draftTranslationB?.utteranceId ||
                              interimTranscriptB?.id ||
                              'draft-channel-b'
                            }
                            isStreaming={draftTranslationB ? draftTranslationB.isStreaming : true}
                            isDraft={true}
                            textColor={draftTranslationColorB}
                            displaySettings={workspaceDisplaySettings}
                            onToggleFlag={handleToggleFlag}
                            onAddToGlossary={handleAddToGlossary}
                          />
                        ) : (
                          <TranslationCard
                            utteranceId={interimTranscriptB?.id || 'accurate-channel-b'}
                            isWaitingForPause={true}
                            isDraft={true}
                            textColor={draftTranslationColorB}
                            displaySettings={workspaceDisplaySettings}
                            onToggleFlag={handleToggleFlag}
                            onAddToGlossary={handleAddToGlossary}
                          />
                        )}
                      </div>
                    )
                  }

                  return (
                    <div className="bg-surface-panel/20">
                      <div className="flex">
                        <div
                          style={{ width: `${splitRatio}%` }}
                          className={`px-6 pt-3 pb-1 border-r ${dividerBorderClass}`}
                        >
                          {interimTranscriptB && (
                            <UtteranceCard
                              utterance={interimTranscriptB}
                              isInterim={true}
                              textColor={draftOriginalColorB}
                              displaySettings={workspaceDisplaySettings}
                              onUpdateSpeakerLabel={handleUpdateSpeakerLabel}
                            />
                          )}
                        </div>
                        <div style={{ width: `${100 - splitRatio}%` }} className="px-6 pt-3 pb-1" />
                      </div>

                      <div className="flex">
                        <div
                          style={{ width: `${splitRatio}%` }}
                          className={`px-6 pt-1 pb-3 border-r ${dividerBorderClass}`}
                        />
                        <div style={{ width: `${100 - splitRatio}%` }} className="px-6 pt-1 pb-3">
                          {isLiveMode ? (
                            <TranslationCard
                              translation={draftTranslationB || undefined}
                              utteranceId={
                                draftTranslationB?.utteranceId ||
                                interimTranscriptB?.id ||
                                'draft-channel-b'
                              }
                              isStreaming={draftTranslationB ? draftTranslationB.isStreaming : true}
                              isDraft={true}
                              textColor={draftTranslationColorB}
                              displaySettings={workspaceDisplaySettings}
                              onToggleFlag={handleToggleFlag}
                              onAddToGlossary={handleAddToGlossary}
                            />
                          ) : (
                            <TranslationCard
                              utteranceId={interimTranscriptB?.id || 'accurate-channel-b'}
                              isWaitingForPause={true}
                              isDraft={true}
                              textColor={draftTranslationColorB}
                              displaySettings={workspaceDisplaySettings}
                              onToggleFlag={handleToggleFlag}
                              onAddToGlossary={handleAddToGlossary}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}

              {/* Bottom Virtual Spacer */}
              {bottomSpacerHeight > 0 && <div style={{ height: `${bottomSpacerHeight}px` }} />}
            </div>
          ) : (
            /* Clean, Calm Empty State: Plain-English Audio Source Picker + Active Mode Guide */
            <div className="flex h-full w-full">
              {/* Left Empty Pane: Audio Source Selector */}
              <div
                style={{ width: `${splitRatio}%` }}
                className="flex flex-col items-center justify-center border-r border-surface-border/60 px-8 py-10"
              >
                <div className="w-full max-w-sm space-y-3">
                  <p className="text-xs font-medium text-text-secondary px-1">
                    Choose where the sound comes from
                  </p>
                  <div className="space-y-1.5">
                    {EMPTY_STATE_ROUTES.map((option) => {
                      const Icon = option.icon
                      const isSelected = audioRoute === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setAudioRoute(option.id)}
                          className={`flex w-full items-start space-x-3 rounded-lg border px-3.5 py-2.5 text-left transition ${
                            isSelected
                              ? 'border-accent-steel/70 bg-accent-steel/10 text-text-primary'
                              : 'border-transparent bg-transparent text-text-secondary hover:bg-surface-panel hover:text-text-primary'
                          }`}
                        >
                          <Icon
                            className={`mt-0.5 h-4 w-4 shrink-0 ${
                              isSelected ? 'text-accent-steel' : 'text-text-muted'
                            }`}
                            strokeWidth={1.75}
                          />
                          <div className="space-y-0.5">
                            <div
                              className={`text-xs font-semibold ${
                                isSelected ? 'text-accent-steel' : 'text-text-primary'
                              }`}
                            >
                              {option.title}
                            </div>
                            <p className="text-[11px] leading-snug text-text-muted">
                              {option.subtitle}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Right Empty Pane: Clear Translation Preview Guide */}
              <div
                style={{ width: `${100 - splitRatio}%` }}
                className="flex flex-col items-center justify-center px-8 py-10 text-center"
              >
                <div className="max-w-sm space-y-3">
                  <MessageSquare
                    className="mx-auto h-6 w-6 text-accent-steel/80"
                    strokeWidth={1.5}
                  />
                  <h2 className="text-sm font-semibold text-text-primary">
                    {operatingMode === 'translate'
                      ? `Translating ${sourceDisplayName} to ${targetDisplayName}`
                      : 'Two-way conversation'}
                  </h2>
                  <p className="text-xs leading-relaxed text-text-muted">
                    {operatingMode === 'translate'
                      ? `Spoken ${sourceDisplayName} appears on the left. What to say in ${targetDisplayName} flows down here and stays visible for easy reference.`
                      : `Translations appear here: ${sourceDisplayName} <-> ${targetDisplayName}. Every line stays saved in view so phone numbers, emails, and details are always accessible.`}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setOperatingMode(operatingMode === 'translate' ? 'conversation' : 'translate')
                    }
                    className="pt-1 text-[11px] text-text-secondary underline decoration-surface-border underline-offset-4 hover:text-text-primary transition"
                  >
                    {operatingMode === 'translate'
                      ? 'Interpreting two speakers? Switch to Conversation.'
                      : 'Everyone speaking one language? Switch to Translate.'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Floating Draggable Split Divider Line Overlay (Only in Dual-Pane 50/50 Mode) */}
        {isDualView && (
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
        )}

        {/* Floating Smart Auto-Scroll Resume Pill */}
        {!isAutoScrollActive && hasLiveContent && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
            <button
              type="button"
              onClick={scrollToBottom}
              className="flex items-center space-x-2 rounded-full border border-accent-steel/60 bg-surface-panel px-4 py-1.5 text-xs font-medium text-text-primary shadow-xl hover:bg-surface-active transition"
            >
              <ArrowDownCircle className="h-3.5 w-3.5 text-accent-steel" />
              <span>
                Jump to latest{unreadCount > 0 ? ` (${unreadCount} new)` : ''}
              </span>
            </button>
          </div>
        )}

        {/* Quiet Glossary Confirmation Toast */}
        {glossaryNotification && (
          <div className="absolute bottom-4 right-5 z-30 flex items-center space-x-2 rounded border border-accent-emerald/50 bg-surface-panel px-3 py-1.5 font-mono text-[11px] text-accent-emerald shadow-lg">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{glossaryNotification}</span>
          </div>
        )}
      </div>
    </div>
  )
}
