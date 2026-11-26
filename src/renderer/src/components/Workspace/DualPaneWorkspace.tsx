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
  ArrowRight,
  AppWindow,
  Check,
  ChevronDown,
  Search
} from 'lucide-react'
import { AudioRouteMode, OperatingMode } from '../../../../types/audio'
import { DOMAIN_PRESETS } from '../../../../types/domain'
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../../../../types/language'
import { useSession } from '../../context/SessionContext'
import { SplitDivider } from './SplitDivider'
import { UtteranceCard } from './UtteranceCard'
import { TranslationCard } from './TranslationCard'
import { GlassSegmentedControl } from '../UI/GlassSegmentedControl'
import { GlassTooltip } from '../UI/GlassTooltip'
import { formatPlatformShortcut } from '../../utils/platform'
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
    subtitle: 'Your voice directly',
    icon: Mic
  },
  {
    id: 'system',
    title: 'System Audio',
    subtitle: 'Meetings & videos',
    icon: Volume2
  },
  {
    id: 'bilateral',
    title: 'Mic + Call',
    subtitle: 'Both sides live',
    icon: ArrowRightLeft
  },
  {
    id: 'app',
    title: 'Single App',
    subtitle: 'One call window',
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
    domainId,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    swapLanguages,
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

  // Interactive Empty State Hero Language & Domain Picker State
  const [heroPicker, setHeroPicker] = useState<'source' | 'target' | null>(null)
  const [heroSearch, setHeroSearch] = useState('')
  const [swapRotation, setSwapRotation] = useState(0)
  const heroContainerRef = useRef<HTMLDivElement>(null)
  const heroSearchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!heroPicker) {
      setHeroSearch('')
      return
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (heroContainerRef.current && !heroContainerRef.current.contains(e.target as Node)) {
        setHeroPicker(null)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHeroPicker(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    setTimeout(() => heroSearchInputRef.current?.focus(), 50)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [heroPicker])

  const filteredHeroLanguages = useMemo(() => {
    if (!heroSearch.trim()) return SUPPORTED_LANGUAGES
    const q = heroSearch.toLowerCase()
    return SUPPORTED_LANGUAGES.filter(
      (l) =>
        l.code.toLowerCase().includes(q) ||
        l.isoName.toLowerCase().includes(q) ||
        l.displayName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q)
    )
  }, [heroSearch])

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

  // 4. Smart Auto-Scroll, Narrow Viewport Adaptation & Virtualization State
  const [isAutoScrollActive, setIsAutoScrollActive] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [viewportWidth, setViewportWidth] = useState(1000)
  const prevItemsLengthRef = useRef(pairedItems.length)

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
        setViewportWidth(entry.contentRect.width)
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
  const isNarrowViewport = viewportWidth < 620
  const viewMode =
    isNarrowViewport && workspaceDisplaySettings.viewMode === 'dual'
      ? 'stacked'
      : workspaceDisplaySettings.viewMode
  const isDualView = viewMode === 'dual'
  const isTargetOnlyView = viewMode === 'target_only'
  const isStackedView = viewMode === 'stacked'
  const rowPaddingClass = lineMetrics.rowPaddingClass
  const dividerBorderClass = workspaceDisplaySettings.highContrast
    ? 'border-white/[0.14]'
    : 'border-white/[0.06]'

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
        className={`glass-control-hover flex items-center space-x-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${
          filterFlaggedOnly
            ? 'border-accent-amber/55 bg-accent-amber/20 text-accent-amber'
            : 'border-white/[0.1] bg-white/[0.05] text-white/65 hover:text-white'
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
      className="relative flex-1 flex flex-col h-full bg-transparent text-text-primary overflow-hidden font-sans"
    >
      {/* Actionable System Audio Loopback / Pipeline Error Banner (Shown Only On Error) */}
      {(pipelineErrorMessage || loopbackStatus === 'unavailable') && (
        <div
          role="alert"
          className="mx-4 mt-3 flex items-center justify-between rounded-2xl border border-accent-crimson/35 bg-accent-crimson/12 backdrop-blur-xl px-4 py-2.5 text-xs text-white shrink-0 animate-glass-pop"
        >
          <span className="truncate pr-3">
            <strong className="text-accent-crimson font-semibold mr-2">Audio Notice:</strong>
            {pipelineErrorMessage || loopbackStatusMessage}
          </span>
          <button
            type="button"
            onClick={openSettingsModal}
            className="glass-control-hover shrink-0 rounded-full border border-accent-crimson/45 bg-white/[0.08] px-3 py-1 text-[11px] font-medium text-white"
          >
            Audio Settings
          </button>
        </div>
      )}

      {/* Subtle Optical Pane Indicator Strip: Shown cleanly once live transcripts appear */}
      {hasLiveContent && (
        <div className={`flex h-8 w-full shrink-0 items-center border-b ${dividerBorderClass} bg-white/[0.015] select-none`}>
          {isDualView ? (
            <>
              <div
                style={{ width: `${splitRatio}%` }}
                className={`flex h-full items-center space-x-2 border-r ${dividerBorderClass} px-6`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent-steel shrink-0" />
                <span className="text-[11px] font-medium text-white/50 tracking-wide truncate">
                  Original
                </span>
              </div>
              <div
                style={{ width: `${100 - splitRatio}%` }}
                className="flex h-full items-center justify-between px-6"
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald shrink-0" />
                  <span className="text-[11px] font-medium text-white/50 tracking-wide truncate">
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
                <span className="text-[11px] font-medium text-white/50 tracking-wide truncate">
                  Translation
                </span>
              </div>
              {renderFlagFilterPill()}
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-between px-5 sm:px-6">
              <div className="flex items-center space-x-2 min-w-0">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-steel shrink-0" />
                <span className="text-[11px] font-medium text-white/50 tracking-wide truncate">
                  Original {'->'} Translation
                </span>
              </div>
              {renderFlagFilterPill()}
            </div>
          )}
        </div>
      )}

      {/* 100% Pure, Full-Height Boxless Transcript Canvas */}
      <div className="relative flex-1 overflow-hidden select-none">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full w-full overflow-y-auto relative"
        >
          {hasLiveContent ? (
            <div className="min-h-full py-3 pb-24">
              {/* Top Virtual Spacer */}
              {topSpacerHeight > 0 && <div style={{ height: `${topSpacerHeight}px` }} />}

              {/* Flowing, Boxless Paired Paragraph Rows */}
              {visibleItems.map((item) => {
                if (isTargetOnlyView) {
                  return (
                    <div
                      key={item.id}
                      className={`animate-utterance px-6 sm:px-8 ${rowPaddingClass} hover:bg-white/[0.025] transition-colors max-w-5xl mx-auto rounded-2xl`}
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
                      className={`animate-utterance px-5 sm:px-6 ${rowPaddingClass} border-b border-white/[0.05] hover:bg-white/[0.025] transition-colors space-y-1 max-w-4xl mx-auto`}
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
                    className="animate-utterance border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
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
            /* Original Apple-Native Centered Session Stage (Bento Horizontal Tiles + Sliding Mode Pill) */
            <div className="flex min-h-full w-full items-center justify-center px-5 py-10 pb-24 sm:px-8">
              <div className="w-full max-w-[760px] flex flex-col items-center text-center space-y-7">
                {/* 1. Calm Editorial Hero */}
                <div className="space-y-2.5">
                  <div className="relative inline-flex items-center justify-center" ref={heroContainerRef}>
                    <div className="glass-capsule-subtle inline-flex items-center space-x-1 rounded-full p-1 text-[11px] font-medium text-white/75 shadow-sm">
                      {/* Source Language Picker Trigger */}
                      <GlassTooltip
                        label="Source Language"
                        description="Click to select source spoken language"
                        disabled={Boolean(heroPicker)}
                      >
                        <button
                          type="button"
                          onClick={() => setHeroPicker((prev) => (prev === 'source' ? null : 'source'))}
                          className={`glass-control-hover flex h-6 w-[84px] sm:w-[96px] items-center justify-between rounded-full px-2.5 text-white/85 transition-colors focus:outline-none ${
                            heroPicker === 'source'
                              ? 'bg-white/[0.16] text-white font-semibold'
                              : 'hover:bg-white/[0.08] hover:text-white'
                          }`}
                        >
                          <span className="truncate pr-1 text-left">{sourceDisplayName}</span>
                          <ChevronDown
                            className={`h-2.5 w-2.5 shrink-0 text-white/40 transition-transform ${
                              heroPicker === 'source' ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                      </GlassTooltip>

                      {/* Symmetrical Language Swap Button */}
                      <GlassTooltip
                        label="Swap Languages"
                        description="Reverse source and target languages"
                        shortcut="Cmd+Shift+S"
                        disabled={Boolean(heroPicker)}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSwapRotation((prev) => prev + 180)
                            swapLanguages()
                          }}
                          aria-label="Swap active languages"
                          className="glass-control-hover flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-accent-steel hover:bg-white/[0.08] hover:text-white focus:outline-none"
                        >
                          {operatingMode === 'conversation' ? (
                            <ArrowRightLeft
                              className="h-3 w-3"
                              strokeWidth={2}
                              style={{
                                transform: `rotate(${swapRotation}deg)`,
                                transition: 'transform 340ms var(--ease-apple-bounce)'
                              }}
                            />
                          ) : (
                            <ArrowRight
                              className="h-3 w-3"
                              strokeWidth={2}
                              style={{
                                transform: `rotate(${swapRotation}deg)`,
                                transition: 'transform 340ms var(--ease-apple-bounce)'
                              }}
                            />
                          )}
                        </button>
                      </GlassTooltip>

                      {/* Target Language Picker Trigger */}
                      <GlassTooltip
                        label="Target Language"
                        description="Click to select target translation language"
                        disabled={Boolean(heroPicker)}
                      >
                        <button
                          type="button"
                          onClick={() => setHeroPicker((prev) => (prev === 'target' ? null : 'target'))}
                          className={`glass-control-hover flex h-6 w-[84px] sm:w-[96px] items-center justify-between rounded-full px-2.5 text-white/85 transition-colors focus:outline-none ${
                            heroPicker === 'target'
                              ? 'bg-white/[0.16] text-white font-semibold'
                              : 'hover:bg-white/[0.08] hover:text-white'
                          }`}
                        >
                          <span className="truncate pr-1 text-left">{targetDisplayName}</span>
                          <ChevronDown
                            className={`h-2.5 w-2.5 shrink-0 text-white/40 transition-transform ${
                              heroPicker === 'target' ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                      </GlassTooltip>

                      <span className="h-3 w-px bg-white/[0.14] my-auto" />

                      {/* Domain Topic Trigger -> Opens Settings to Interpretation Tab */}
                      <GlassTooltip
                        label="Specialized Domain"
                        description="Click to open Settings and tune specialized vocabulary"
                        disabled={Boolean(heroPicker)}
                      >
                        <button
                          type="button"
                          onClick={() => openSettingsModal('interpretation')}
                          className="glass-control-hover flex items-center space-x-1 rounded-full px-2.5 py-1 text-white/60 hover:text-white hover:bg-white/[0.08] focus:outline-none"
                        >
                          <span>{(DOMAIN_PRESETS[domainId]?.label || 'General').split('/')[0].trim()}</span>
                        </button>
                      </GlassTooltip>
                    </div>

                    {/* Hero Language Dropdown */}
                    {heroPicker && (
                      <div
                        role="listbox"
                        tabIndex={-1}
                        className="glass-sheet animate-glass-pop absolute top-10 z-50 w-[280px] rounded-[20px] p-2 text-left shadow-2xl"
                      >
                        <div className="relative mb-2">
                          <Search
                            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40"
                            strokeWidth={1.75}
                          />
                          <input
                            ref={heroSearchInputRef}
                            type="text"
                            value={heroSearch}
                            onChange={(e) => setHeroSearch(e.target.value)}
                            placeholder={`Search ${
                              heroPicker === 'source' ? 'source' : 'target'
                            } language...`}
                            className="h-8 w-full rounded-full border border-white/[0.09] bg-white/[0.06] pl-8 pr-3 text-xs text-white placeholder:text-white/35 focus:border-accent-steel/70 focus:bg-white/[0.09] focus:outline-none transition"
                          />
                        </div>

                        <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
                          {filteredHeroLanguages.length === 0 ? (
                            <div className="py-5 text-center text-xs text-white/40">
                              No languages found
                            </div>
                          ) : (
                            filteredHeroLanguages.map((lang: SupportedLanguage) => {
                              const isSelected =
                                heroPicker === 'source'
                                  ? lang.code === sourceLang
                                  : lang.code === targetLang
                              return (
                                <button
                                  key={lang.code}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  onClick={() => {
                                    if (heroPicker === 'source') {
                                      setSourceLang(lang.code)
                                    } else {
                                      setTargetLang(lang.code)
                                    }
                                    setHeroPicker(null)
                                  }}
                                  className={`glass-control-hover flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                                    isSelected
                                      ? 'bg-accent-steel/25 text-white font-semibold'
                                      : 'text-white/80 hover:bg-white/[0.07] hover:text-white'
                                  }`}
                                >
                                  <div className="flex flex-col min-w-0 pr-2">
                                    <span className="truncate">{lang.displayName}</span>
                                    <span className="truncate text-[10px] text-white/45">
                                      {lang.nativeName} ({lang.code.toUpperCase()})
                                    </span>
                                  </div>
                                  {isSelected && (
                                    <Check
                                      className="h-3.5 w-3.5 text-accent-steel shrink-0"
                                      strokeWidth={2.5}
                                    />
                                  )}
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <h1 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-white">
                    Ready to interpret
                  </h1>

                  <p className="mx-auto max-w-md text-xs leading-relaxed text-white/50">
                    {operatingMode === 'conversation'
                      ? `Listening to both ${sourceDisplayName} and ${targetDisplayName}. Choose your audio input below and press Start.`
                      : `Translating spoken ${sourceDisplayName} into ${targetDisplayName} in real time. Choose your audio input below and press Start.`}
                  </p>
                </div>

                {/* 2. Sliding Liquid Glass Mode Switcher */}
                <div>
                  <GlassSegmentedControl<OperatingMode>
                    ariaLabel="Interpretation Mode"
                    value={operatingMode}
                    onChange={setOperatingMode}
                    size="md"
                    options={[
                      {
                        id: 'translate',
                        label: 'One-Way Translate',
                        icon: ArrowRight,
                        title: 'Translate one spoken language into your target language'
                      },
                      {
                        id: 'conversation',
                        label: 'Two-Way Conversation',
                        icon: ArrowRightLeft,
                        title: 'Automatically translate back and forth between two speakers'
                      }
                    ]}
                  />
                </div>

                {/* 3. Horizontal 4-Card Liquid Glass Bento Audio Selector */}
                <div
                  role="radiogroup"
                  aria-label="Choose where the sound comes from"
                  className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4"
                >
                  {EMPTY_STATE_ROUTES.map((option) => {
                    const Icon = option.icon
                    const isSelected = audioRoute === option.id
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setAudioRoute(option.id)}
                        className={`glass-control-hover group relative flex flex-col items-start justify-between rounded-[22px] border p-4 text-left min-h-[112px] ${
                          isSelected
                            ? 'border-accent-steel/60 bg-accent-steel/14 text-white shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.2),0_12px_28px_-10px_rgba(10,132,255,0.35)]'
                            : 'glass-grouped-card text-white/75 hover:bg-white/[0.08] hover:text-white'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <div
                            className={`flex h-9 w-9 items-center justify-center rounded-2xl transition-colors ${
                              isSelected
                                ? 'bg-accent-steel text-white shadow-sm'
                                : 'bg-white/[0.08] text-white/65 group-hover:text-white'
                            }`}
                          >
                            <Icon className="h-4 w-4" strokeWidth={1.8} />
                          </div>

                          {isSelected && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-steel/25 text-accent-steel">
                              <Check className="h-3 w-3" strokeWidth={2.5} />
                            </span>
                          )}
                        </div>

                        <div className="mt-4 space-y-0.5">
                          <div className="text-[13px] font-semibold tracking-tight text-white leading-tight">
                            {option.title}
                          </div>
                          <div className="text-[11px] text-white/45 leading-snug">
                            {option.subtitle}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* 4. Whisper-Quiet Keyboard Hint Strip */}
                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-1 text-[11px] text-white/38">
                  <span className="flex items-center space-x-1.5">
                    <kbd className="rounded-md border border-white/[0.1] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-white/60">
                      SPACE
                    </kbd>
                    <span>Mute</span>
                  </span>
                  <span className="flex items-center space-x-1.5">
                    <kbd className="rounded-md border border-white/[0.1] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-white/60">
                      {formatPlatformShortcut('CommandOrControl+Shift+S')}
                    </kbd>
                    <span>Swap languages</span>
                  </span>
                  <span className="flex items-center space-x-1.5">
                    <kbd className="rounded-md border border-white/[0.1] bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-white/60">
                      {formatPlatformShortcut('CommandOrControl+Shift+H')}
                    </kbd>
                    <span>Mini View</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Floating Draggable Split Divider Line Overlay (Only in Dual-Pane 50/50 Mode with Live Content) */}
        {isDualView && hasLiveContent && (
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

        {/* Floating Liquid Glass Auto-Scroll Resume Pill */}
        {!isAutoScrollActive && hasLiveContent && (
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 animate-glass-pop-up">
            <button
              type="button"
              onClick={scrollToBottom}
              className="glass-capsule glass-control-hover flex items-center space-x-2 rounded-full px-4 py-2 text-xs font-medium text-white"
            >
              <ArrowDownCircle className="h-3.5 w-3.5 text-accent-steel" strokeWidth={1.85} />
              <span>
                Jump to latest{unreadCount > 0 ? ` (${unreadCount} new)` : ''}
              </span>
            </button>
          </div>
        )}

        {/* Quiet Liquid Glass Glossary Confirmation Toast (Positioned cleanly above bottom-right transport pill) */}
        {glossaryNotification && (
          <div className="glass-capsule animate-glass-pop-up absolute bottom-20 right-5 z-30 flex items-center space-x-2 rounded-full px-3.5 py-2 text-[11px] font-medium text-accent-emerald">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.85} />
            <span>{glossaryNotification}</span>
          </div>
        )}
      </div>
    </div>
  )
}
