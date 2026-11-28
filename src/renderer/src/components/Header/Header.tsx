import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowRightLeft,
  PictureInPicture2,
  Settings,
  MousePointerClick
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { LanguageSelector } from '../SubHeader/LanguageSelector'
import { WorkspaceLayoutPopover } from '../SubHeader/WorkspaceLayoutPopover'
import { TextPersonalizationPopover } from '../SubHeader/TextPersonalizationPopover'
import { AudioSourcePopover } from './AudioSourcePopover'
import { ModeTopicPopover } from './ModeTopicPopover'
import { QuotaGauge } from './QuotaGauge'
import { AcousticPulse } from '../UI/AcousticPulse'
import { AppleSwitch } from '../UI/AppleSwitch'
import { GlassTooltip } from '../UI/GlassTooltip'
import { isMac, isWindows } from '../../utils/platform'

/**
 * DUALAI — Unified Apple macOS Tahoe Liquid Glass Top Command Bar
 * Clean top navigation bar with live status on the left, unified language pair in the center,
 * and single-purpose tool capsules on the right (while Start/Stop & Mute float intuitively at bottom-right).
 */
export const Header: React.FC = () => {
  const {
    isAudioActive,
    isSystemAudioMuted,
    pipelineState,
    endToEndLatencyMs,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    swapLanguages,
    openSettingsModal,
    isHudOpen,
    hudSettings,
    toggleHud,
    updateHudSettings
  } = useSession()

  const toolbarRef = useRef<HTMLElement>(null)
  const hudPopoverRef = useRef<HTMLDivElement>(null)
  const [swapRotation, setSwapRotation] = useState(0)
  const [showHudPopover, setShowHudPopover] = useState(false)
  const isWin = isWindows

  useEffect(() => {
    if (!showHudPopover) return
    const handleOutside = (e: MouseEvent) => {
      if (hudPopoverRef.current && !hudPopoverRef.current.contains(e.target as Node)) {
        setShowHudPopover(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowHudPopover(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [showHudPopover])

  const handleSwapClick = (): void => {
    setSwapRotation((prev) => prev + 180)
    swapLanguages()
  }

  const handleToolbarKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!toolbarRef.current) return
    const buttons = Array.from(
      toolbarRef.current.querySelectorAll<HTMLButtonElement>(
        'button[data-toolbar-item="true"]:not(:disabled)'
      )
    )
    if (buttons.length === 0) return

    const currentIdx = buttons.findIndex((btn) => btn === document.activeElement)
    if (currentIdx === -1) return

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      buttons[(currentIdx + 1) % buttons.length].focus()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      buttons[(currentIdx - 1 + buttons.length) % buttons.length].focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      buttons[0].focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      buttons[buttons.length - 1].focus()
    }
  }

  const isLivePulsing =
    isAudioActive &&
    !isSystemAudioMuted &&
    (pipelineState.state === 'listening' ||
      pipelineState.state === 'transcribing' ||
      pipelineState.state === 'translating')

  return (
    <header
      ref={toolbarRef}
      role="toolbar"
      aria-label="Master Session Command Bar"
      onKeyDown={handleToolbarKeyDown}
      className={`app-drag-region relative z-40 flex h-[54px] w-full shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.02] backdrop-blur-2xl select-none ${
        isMac ? 'pl-[80px] pr-3.5' : isWin ? 'pl-3.5 pr-[148px]' : 'px-3.5'
      }`}
    >
      {/* LEFT CLUSTER: Calm App Identity & Live Acoustic Status Pill */}
      <div className="app-no-drag flex items-center space-x-2.5 shrink-0">
        <span className="hidden md:inline text-[13px] font-semibold tracking-tight text-white/85">
          DualAI
        </span>

        {/* Plain-English Live Status Indicator */}
        <div
          role="status"
          aria-live="polite"
          title={`Latency: ${endToEndLatencyMs > 0 ? `${endToEndLatencyMs}ms` : '--'}`}
          className={`flex items-center space-x-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-200 ${
            isAudioActive
              ? 'bg-white/[0.07] border border-white/[0.1] text-white/90'
              : 'hidden sm:flex text-white/45'
          }`}
        >
          <AcousticPulse active={isLivePulsing} tone={pipelineState.accentToken} />
          <span className="truncate max-w-[115px]">{pipelineState.label}</span>
        </div>
      </div>

      {/* CAPSULE 2 (TRUE MATHEMATICAL CENTER): Unified Language Pair Capsule */}
      <div
        className={`app-no-drag flex items-center justify-center min-w-0 ${
          isWin
            ? 'xl:absolute xl:left-1/2 xl:-translate-x-1/2'
            : 'lg:absolute lg:left-1/2 lg:-translate-x-1/2'
        }`}
        data-tour-id="languages"
      >
        <div className="glass-capsule flex h-9 items-center space-x-0.5 rounded-full px-1">
          <LanguageSelector
            label="Source Language"
            selectedCode={sourceLang}
            onSelectLanguage={setSourceLang}
          />

          <GlassTooltip label="Swap Languages" shortcut="Cmd+Shift+S">
            <button
              type="button"
              data-toolbar-item="true"
              onClick={handleSwapClick}
              aria-label="Swap Source and Target Languages"
              className="glass-control-hover flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70"
            >
              <ArrowRightLeft
                className="h-3.5 w-3.5"
                strokeWidth={1.75}
                style={{
                  transform: `rotate(${swapRotation}deg)`,
                  transition: 'transform 340ms var(--ease-apple-bounce)'
                }}
              />
            </button>
          </GlassTooltip>

          <LanguageSelector
            label="Target Language"
            selectedCode={targetLang}
            onSelectLanguage={setTargetLang}
          />
        </div>
      </div>

      {/* CAPSULE 3 & 4 (RIGHT): Single-Purpose Tools + Account & Settings */}
      <div className="app-no-drag flex items-center space-x-1.5 shrink-0">
        {/* Capsule 3: 1 Clear Job per Button */}
        <div className="glass-capsule flex h-9 items-center space-x-0.5 rounded-full p-1">
          {/* 1. Audio Source */}
          <AudioSourcePopover />

          {/* 2. Mode & Topic */}
          <ModeTopicPopover />

          <span className="hidden sm:block h-3.5 w-px bg-white/[0.1]" />

          {/* 3. Reading Layout & 4. Text & Colors */}
          <div className="hidden sm:flex items-center space-x-0.5">
            <WorkspaceLayoutPopover />
            <TextPersonalizationPopover />
          </div>

          <span className="h-3.5 w-px bg-white/[0.1]" />

          {/* 5. Unified Mini View Floating Overlay Control */}
          <div ref={hudPopoverRef} className="relative flex items-center" data-tour-id="teleprompter">
            <GlassTooltip
              label="Mini View Settings"
              description={
                isHudOpen ? 'Active above your calls — tune opacity, size & lines' : 'Open or configure compact floating overlay'
              }
              shortcut="Cmd+Shift+H"
              align="right"
              disabled={showHudPopover}
            >
              <button
                type="button"
                data-toolbar-item="true"
                onClick={() => setShowHudPopover((prev) => !prev)}
                aria-expanded={showHudPopover}
                aria-haspopup="dialog"
                aria-label="Mini View Floating Overlay Controls"
                className={`glass-control-hover relative flex h-7 items-center space-x-1.5 rounded-full px-2 text-[11px] font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                  isHudOpen
                    ? 'bg-accent-emerald/20 text-accent-emerald border border-accent-emerald/40'
                    : showHudPopover
                      ? 'bg-white/[0.15] text-white'
                      : 'text-white/75 hover:text-white'
                }`}
              >
                <PictureInPicture2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                {isHudOpen && (
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald animate-pulse" />
                )}
              </button>
            </GlassTooltip>

            {showHudPopover && (
              <div
                role="dialog"
                aria-label="Mini View Quick Settings"
                className="glass-sheet animate-glass-pop absolute right-0 top-10 z-50 w-72 rounded-[22px] p-4 space-y-3.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold text-white">Mini View</div>
                    <div className="text-[10px] text-white/45">
                      {isHudOpen ? 'Floating above your video call' : 'Compact floating overlay'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleHud()}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                      isHudOpen
                        ? 'bg-accent-crimson/20 text-accent-crimson border border-accent-crimson/40 hover:bg-accent-crimson/30'
                        : 'glass-cta-start'
                    }`}
                  >
                    {isHudOpen ? 'Close' : 'Open'}
                  </button>
                </div>

                <div className="glass-grouped-card rounded-2xl p-3 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white/70">Glass Opacity</span>
                      <span className="font-mono tabular-nums text-white">
                        {Math.round(hudSettings.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={hudSettings.opacity}
                      onChange={(e) => updateHudSettings({ opacity: parseFloat(e.target.value) })}
                      className="apple-slider w-full"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white/70">Text Size</span>
                      <span className="font-mono tabular-nums text-white">
                        {hudSettings.fontSizePx}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="14"
                      max="48"
                      step="1"
                      value={hudSettings.fontSizePx}
                      onChange={(e) =>
                        updateHudSettings({ fontSizePx: parseInt(e.target.value, 10) })
                      }
                      className="apple-slider w-full"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-0.5">
                    <span className="text-[11px] text-white/70">Visible Lines</span>
                    <div className="flex items-center space-x-1 rounded-full bg-white/[0.06] p-0.5">
                      {([2, 4, 6] as const).map((limit) => (
                        <button
                          key={limit}
                          type="button"
                          onClick={() => updateHudSettings({ lineLimit: limit })}
                          className={`h-6 w-7 rounded-full text-[11px] font-medium transition ${
                            hudSettings.lineLimit === limit
                              ? 'bg-white/[0.18] text-white shadow-sm'
                              : 'text-white/50 hover:text-white'
                          }`}
                        >
                          {limit}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="glass-grouped-card flex items-center justify-between rounded-2xl px-3 py-2.5">
                  <div className="flex items-center space-x-2">
                    <MousePointerClick className="h-3.5 w-3.5 text-white/60" strokeWidth={1.75} />
                    <div>
                      <div className="text-[11px] font-medium text-white/85">Click-Through</div>
                      <div className="text-[10px] text-white/40">Click apps behind HUD</div>
                    </div>
                  </div>
                  <AppleSwitch
                    checked={hudSettings.isClickThrough}
                    onChange={(next) => updateHudSettings({ isClickThrough: next })}
                    ariaLabel="Toggle Teleprompter Click-Through"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Capsule 4: Account Avatar & Settings */}
        <div className="glass-capsule flex h-9 items-center space-x-0.5 rounded-full p-1">
          <QuotaGauge />

          <div data-tour-id="settings" className="inline-flex">
            <GlassTooltip
              label="Settings"
              description="Audio devices, reading & shortcuts"
              shortcut="Cmd+,"
              align="right"
            >
              <button
                type="button"
                data-toolbar-item="true"
                onClick={openSettingsModal}
                aria-label="Open Settings"
                className="glass-control-hover flex h-7 w-7 items-center justify-center rounded-full text-white/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70"
              >
                <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </GlassTooltip>
          </div>
        </div>
      </div>
    </header>
  )
}
