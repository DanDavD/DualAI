/**
 * DUALAI - Zone 4 Clean Master Transport Toolbar (CARD-15 & Day 09)
 * Minimalist DAW footer presenting:
 * - Clear plain-English live status (Ready, Listening, Recognizing voice, Translating, Muted)
 * - Instantaneous Zero-Gain Cough Mute trigger (Spacebar / Cmd+Shift+M)
 * - Clear Feed, Teleprompter HUD toggle & quick popover, and Configuration trigger
 * - Single unambiguous Master Start/Stop Translation button (Steel Blue / Solid Crimson)
 * - Full ARIA keyboard navigation (Tab + Left/Right Arrow + Home/End roving focus)
 */

import React, { useRef, useState } from 'react'
import {
  Play,
  Square,
  Mic,
  MicOff,
  Monitor,
  Sliders,
  Trash2,
  MousePointerClick,
  Eye
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'

export const MasterToolbar: React.FC = () => {
  const {
    isAudioActive,
    isInitializingAudio,
    isCoughMuted,
    pipelineState,
    endToEndLatencyMs,
    utterances,
    startAudioEngine,
    stopAudioEngine,
    toggleCoughMute,
    clearTranscripts,
    openSettingsModal,
    isHudOpen,
    hudSettings,
    toggleHud,
    updateHudSettings
  } = useSession()

  const toolbarRef = useRef<HTMLDivElement>(null)
  const [showHudPopover, setShowHudPopover] = useState(false)

  // Full keyboard navigation across all toolbar action items (Left / Right arrows + Home / End)
  const handleToolbarKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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

  const getStatusStyle = () => {
    switch (pipelineState.accentToken) {
      case 'emerald':
        return {
          dot: 'bg-accent-emerald animate-pulse',
          text: 'text-accent-emerald'
        }
      case 'steel':
        return {
          dot: 'bg-accent-steel animate-pulse',
          text: 'text-accent-steel'
        }
      case 'amber':
        return {
          dot: 'bg-accent-amber animate-pulse',
          text: 'text-accent-amber'
        }
      case 'crimson':
        return {
          dot: 'bg-accent-crimson',
          text: 'text-accent-crimson'
        }
      default:
        return {
          dot: 'bg-text-muted',
          text: 'text-text-secondary'
        }
    }
  }

  const statusStyle = getStatusStyle()

  return (
    <footer
      ref={toolbarRef}
      role="toolbar"
      aria-label="Master Session Control Toolbar"
      onKeyDown={handleToolbarKeyDown}
      className="relative flex h-13 shrink-0 items-center justify-between border-t border-surface-border bg-surface-panel px-4 text-xs select-none"
    >
      {/* Left Cluster: Clean Plain-English Live Status (Ready / Listening / Recognizing voice / Translating) */}
      <div
        className="flex items-center space-x-2"
        role="status"
        aria-live="polite"
        title={`Buffer: ${pipelineState.bufferMs}ms | E2E Latency: ${endToEndLatencyMs > 0 ? `${endToEndLatencyMs}ms` : '--'}`}
      >
        <span className={`h-2 w-2 rounded-full ${statusStyle.dot}`} />
        <span className={`text-xs font-medium ${statusStyle.text}`}>{pipelineState.label}</span>
      </div>

      {/* Right Cluster: Mute, Clear, Teleprompter HUD, Settings & Single Primary Transport Control */}
      <div className="flex items-center space-x-2">
        {/* Instant Zero-Gain Cough Mute (Spacebar) */}
        <button
          type="button"
          data-toolbar-item="true"
          onClick={toggleCoughMute}
          aria-pressed={isCoughMuted}
          aria-label={
            isCoughMuted ? 'Unmute microphone (Spacebar)' : 'Engage instant cough mute (Spacebar)'
          }
          className={`flex h-8 items-center space-x-1.5 rounded border px-2.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-accent-steel ${
            isCoughMuted
              ? 'border-accent-crimson bg-accent-crimson/20 text-accent-crimson hover:bg-accent-crimson/30'
              : 'border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary'
          }`}
          title="Instant cough mute (0ms bleed) — Spacebar or Cmd/Ctrl+Shift+M"
        >
          {isCoughMuted ? (
            <>
              <MicOff className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span>Muted</span>
            </>
          ) : (
            <>
              <Mic className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.75} />
              <span className="hidden sm:inline">Mute</span>
            </>
          )}
          <kbd className="hidden md:inline rounded border border-surface-border bg-surface-panel px-1 py-0.5 font-mono text-[9px] text-text-muted">
            SPACE
          </kbd>
        </button>

        {/* Clear Feed */}
        <button
          type="button"
          data-toolbar-item="true"
          onClick={clearTranscripts}
          disabled={utterances.length === 0}
          aria-label="Clear transcript history"
          className="flex h-8 w-8 items-center justify-center rounded border border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-accent-crimson disabled:opacity-35 focus:outline-none focus:ring-2 focus:ring-accent-steel transition"
          title="Clear transcript history (Cmd/Ctrl+Shift+K)"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        {/* Teleprompter Floating Overlay Toggle (Day 10) */}
        <div className="flex items-center">
          <button
            type="button"
            data-toolbar-item="true"
            onClick={() => void toggleHud()}
            aria-pressed={isHudOpen}
            aria-label="Toggle Floating Teleprompter HUD"
            className={`flex h-8 items-center space-x-1.5 rounded-l border px-2.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-accent-steel ${
              isHudOpen
                ? 'border-accent-emerald/50 bg-accent-emerald/15 text-accent-emerald'
                : 'border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary'
            }`}
            title="Toggle Floating Teleprompter (Cmd/Ctrl+Shift+H)"
          >
            <Monitor className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>Teleprompter</span>
          </button>

          <button
            type="button"
            data-toolbar-item="true"
            onClick={() => setShowHudPopover((prev) => !prev)}
            aria-expanded={showHudPopover}
            aria-label="Teleprompter HUD Settings"
            className={`flex h-8 w-8 items-center justify-center rounded-r border-y border-r transition focus:outline-none focus:ring-2 focus:ring-accent-steel ${
              showHudPopover
                ? 'border-accent-steel bg-accent-steel/15 text-accent-steel'
                : 'border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary'
            }`}
            title="Adjust Teleprompter Opacity, Font Scale, Line Limit & Click-Through"
          >
            <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>

        {/* Settings Trigger */}
        <button
          type="button"
          data-toolbar-item="true"
          onClick={openSettingsModal}
          aria-label="Open Settings Matrix"
          className="flex h-8 w-8 items-center justify-center rounded border border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-steel transition"
          title="Settings & Custom Glossary (Cmd/Ctrl+,)"
        >
          <Sliders className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        {/* Single Primary Master Start/Stop Translation Button (Steel Blue / Solid Crimson) */}
        <button
          type="button"
          data-toolbar-item="true"
          disabled={isInitializingAudio}
          onClick={isAudioActive ? stopAudioEngine : startAudioEngine}
          aria-pressed={isAudioActive}
          aria-label={isAudioActive ? 'Stop Translation Session' : 'Start Translation Session'}
          className={`flex h-8 min-w-[168px] items-center justify-center space-x-2 rounded px-4 text-xs font-semibold tracking-wide text-white transition focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface-panel ${
            isAudioActive
              ? 'bg-accent-crimson hover:bg-red-700 focus:ring-accent-crimson'
              : 'bg-accent-steel hover:bg-blue-700 focus:ring-accent-steel'
          } disabled:opacity-60`}
        >
          {isAudioActive ? (
            <>
              <Square className="h-3 w-3 fill-current" strokeWidth={1.5} />
              <span>STOP TRANSLATION</span>
            </>
          ) : (
            <>
              <Play className="h-3 w-3 fill-current" strokeWidth={1.5} />
              <span>{isInitializingAudio ? 'STARTING...' : 'START TRANSLATION'}</span>
            </>
          )}
        </button>
      </div>

      {/* HUD Quick Control Popover */}
      {showHudPopover && (
        <div
          role="dialog"
          aria-label="Teleprompter HUD Quick Settings"
          className="absolute bottom-14 right-4 z-50 w-80 rounded-lg border border-surface-border bg-surface-panel p-4 shadow-2xl space-y-3 font-mono text-xs"
        >
          <div className="flex items-center justify-between border-b border-surface-border pb-2">
            <span className="font-bold text-text-primary uppercase tracking-wider text-[11px]">
              Teleprompter HUD Controls
            </span>
            <span className="text-[10px] text-text-muted">
              {isHudOpen ? 'WINDOW OPEN' : 'CLOSED'}
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-text-secondary">
              <span>Background Opacity (Zinc)</span>
              <span className="text-text-primary font-semibold">
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
              className="w-full accent-accent-steel cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-text-secondary">
              <span>Typography Scale (Geist Mono)</span>
              <span className="text-text-primary font-semibold">{hudSettings.fontSizePx}px</span>
            </div>
            <input
              type="range"
              min="14"
              max="48"
              step="1"
              value={hudSettings.fontSizePx}
              onChange={(e) => updateHudSettings({ fontSizePx: parseInt(e.target.value, 10) })}
              className="w-full accent-accent-steel cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-secondary">Line Limit</span>
            <div className="flex space-x-1">
              {([2, 4, 6] as const).map((limit) => (
                <button
                  key={limit}
                  type="button"
                  onClick={() => updateHudSettings({ lineLimit: limit })}
                  className={`px-2 py-0.5 rounded border text-[11px] transition ${
                    hudSettings.lineLimit === limit
                      ? 'border-accent-steel bg-accent-steel/20 text-accent-steel font-bold'
                      : 'border-surface-border bg-surface-base text-text-muted hover:text-text-primary'
                  }`}
                >
                  {limit} Lines
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-surface-border-subtle">
            <div className="flex items-center space-x-1.5 text-[11px] text-text-secondary">
              <MousePointerClick className="h-3.5 w-3.5 text-text-muted" />
              <span>Click-Through Mode</span>
            </div>
            <button
              type="button"
              onClick={() => updateHudSettings({ isClickThrough: !hudSettings.isClickThrough })}
              className={`px-2.5 py-1 rounded border text-[10px] font-bold transition ${
                hudSettings.isClickThrough
                  ? 'border-accent-amber bg-accent-amber/20 text-accent-amber'
                  : 'border-surface-border bg-surface-base text-text-muted hover:text-text-primary'
              }`}
            >
              {hudSettings.isClickThrough ? 'LOCKED (PASS-THROUGH)' : 'INTERACTIVE'}
            </button>
          </div>
        </div>
      )}
    </footer>
  )
}
