/**
 * DUALAI - Zone 4 Master Toolbar, Cough/Mute Buffer & State Machine Readout (Day 09)
 * Bottom DAW-inspired transport bar providing:
 * - Instantaneous Zero-Gain Cough Mute trigger (Spacebar / Cmd+Shift+M)
 * - Master Start/Stop Translation state button (Steel Blue / Solid Crimson)
 * - Deterministic System State Machine readout (Idle, Listening, Transcribing, Buffer ms)
 * - Teleprompter HUD trigger & quick controls popover (Day 10)
 * - Configuration Matrix trigger (Day 11)
 * - Full ARIA keyboard navigation (Tab + Left/Right Arrow roving focus)
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
  Activity,
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
      toolbarRef.current.querySelectorAll<HTMLButtonElement>('button[data-toolbar-item="true"]:not(:disabled)')
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

  const getStateIndicatorClasses = () => {
    switch (pipelineState.accentToken) {
      case 'emerald':
        return {
          dot: 'bg-accent-emerald',
          text: 'text-accent-emerald',
          badge: 'border-accent-emerald/30 bg-accent-emerald/10'
        }
      case 'steel':
        return {
          dot: 'bg-accent-steel',
          text: 'text-accent-steel',
          badge: 'border-accent-steel/30 bg-accent-steel/10'
        }
      case 'amber':
        return {
          dot: 'bg-accent-amber animate-pulse',
          text: 'text-accent-amber',
          badge: 'border-accent-amber/30 bg-accent-amber/10'
        }
      case 'crimson':
        return {
          dot: 'bg-accent-crimson',
          text: 'text-accent-crimson',
          badge: 'border-accent-crimson/40 bg-accent-crimson/15'
        }
      default:
        return {
          dot: 'bg-text-muted',
          text: 'text-text-secondary',
          badge: 'border-surface-border bg-surface-base'
        }
    }
  }

  const indicator = getStateIndicatorClasses()

  return (
    <footer
      ref={toolbarRef}
      role="toolbar"
      aria-label="Master Session Control Toolbar"
      onKeyDown={handleToolbarKeyDown}
      className="relative flex h-12 shrink-0 items-center justify-between border-t border-surface-border bg-surface-panel px-4 font-mono text-xs select-none"
    >
      {/* Left Cluster: System State Machine Readout & Buffer Telemetry */}
      <div className="flex items-center space-x-3" role="status" aria-live="polite">
        <div
          className={`flex items-center space-x-2 rounded border px-2.5 py-1 ${indicator.badge}`}
        >
          <span className={`h-2 w-2 rounded-full ${indicator.dot}`} />
          <span className={`text-[11px] font-bold tracking-wide ${indicator.text}`}>
            {pipelineState.label}
          </span>
        </div>

        <div className="flex items-center space-x-2 text-[11px] text-text-muted">
          <Activity className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.5} />
          <span>
            BUF: <strong className="text-text-secondary">{pipelineState.bufferMs}ms</strong>
          </span>
          <span className="h-3 w-px bg-surface-border" />
          <span>
            E2E:{' '}
            <strong className="text-text-secondary">
              {endToEndLatencyMs > 0 ? `${endToEndLatencyMs}ms` : '--'}
            </strong>
          </span>
        </div>
      </div>

      {/* Center Cluster: Instant Cough/Mute & Master Start/Stop Translation Button */}
      <div className="flex items-center space-x-2.5">
        {/* Cough / Mute Instant Trigger (Spacebar) */}
        <button
          type="button"
          data-toolbar-item="true"
          onClick={toggleCoughMute}
          aria-pressed={isCoughMuted}
          aria-label={isCoughMuted ? 'Unmute microphone (Spacebar)' : 'Engage instant cough mute (Spacebar)'}
          className={`flex h-8 items-center space-x-2 rounded border px-3 text-xs font-bold tracking-tight transition focus:outline-none focus:ring-2 focus:ring-accent-steel ${
            isCoughMuted
              ? 'border-accent-crimson bg-accent-crimson/20 text-accent-crimson hover:bg-accent-crimson/30'
              : 'border-surface-border bg-surface-base text-text-primary hover:bg-surface-active'
          }`}
          title="Instant zero-gain cough mute (0ms bleed) — Shortcut: Spacebar or Cmd/Ctrl+Shift+M"
        >
          {isCoughMuted ? (
            <>
              <MicOff className="h-3.5 w-3.5" strokeWidth={2} />
              <span>COUGH MUTE ACTIVE</span>
            </>
          ) : (
            <>
              <Mic className="h-3.5 w-3.5 text-accent-emerald" strokeWidth={2} />
              <span>COUGH MUTE</span>
            </>
          )}
          <kbd className="rounded border border-surface-border bg-surface-panel px-1.5 py-0.5 text-[10px] font-normal text-text-muted">
            SPACE
          </kbd>
        </button>

        {/* Master Start/Stop Translation Button (Steel Blue / Solid Crimson) */}
        <button
          type="button"
          data-toolbar-item="true"
          disabled={isInitializingAudio}
          onClick={isAudioActive ? stopAudioEngine : startAudioEngine}
          aria-pressed={isAudioActive}
          aria-label={isAudioActive ? 'Stop Translation Session' : 'Start Translation Session'}
          className={`flex h-8 min-w-[184px] items-center justify-center space-x-2 rounded px-4 text-xs font-bold tracking-wide text-white transition focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-surface-panel ${
            isAudioActive
              ? 'bg-accent-crimson hover:bg-red-700 focus:ring-accent-crimson'
              : 'bg-accent-steel hover:bg-blue-700 focus:ring-accent-steel'
          } disabled:opacity-60`}
        >
          {isAudioActive ? (
            <>
              <Square className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
              <span>STOP TRANSLATION</span>
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 fill-current" strokeWidth={1.5} />
              <span>{isInitializingAudio ? 'STARTING...' : 'START TRANSLATION'}</span>
            </>
          )}
        </button>
      </div>

      {/* Right Cluster: HUD Toggle, HUD Controls, Clear Buffer, Settings Matrix */}
      <div className="flex items-center space-x-1.5">
        {/* Toggle Floating Teleprompter HUD (Day 10) */}
        <button
          type="button"
          data-toolbar-item="true"
          onClick={() => void toggleHud()}
          aria-pressed={isHudOpen}
          aria-label="Toggle Floating Teleprompter HUD"
          className={`flex h-8 items-center space-x-1.5 rounded border px-2.5 text-[11px] font-medium transition focus:outline-none focus:ring-2 focus:ring-accent-steel ${
            isHudOpen
              ? 'border-accent-emerald/50 bg-accent-emerald/15 text-accent-emerald'
              : 'border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary'
          }`}
          title="Toggle Floating Overlay HUD (Cmd/Ctrl+Shift+H)"
        >
          <Monitor className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>{isHudOpen ? 'HUD ACTIVE' : 'HUD OVERLAY'}</span>
        </button>

        {/* HUD Quick Settings Popover Trigger (enables disabling click-through from main window) */}
        <button
          type="button"
          data-toolbar-item="true"
          onClick={() => setShowHudPopover((prev) => !prev)}
          aria-expanded={showHudPopover}
          aria-label="HUD Overlay Controls"
          className={`flex h-8 w-8 items-center justify-center rounded border transition focus:outline-none focus:ring-2 focus:ring-accent-steel ${
            showHudPopover
              ? 'border-accent-steel bg-accent-steel/15 text-accent-steel'
              : 'border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary'
          }`}
          title="Adjust HUD Opacity, Font Scale, Line Limit & Click-Through"
        >
          <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        {/* Clear Buffer */}
        <button
          type="button"
          data-toolbar-item="true"
          onClick={clearTranscripts}
          aria-label="Clear session buffer"
          className="flex h-8 w-8 items-center justify-center rounded border border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-accent-crimson focus:outline-none focus:ring-2 focus:ring-accent-steel transition"
          title="Clear Feed & Context Buffer (Cmd/Ctrl+Shift+K)"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        {/* Open Configuration Matrix (Day 11) */}
        <button
          type="button"
          data-toolbar-item="true"
          onClick={openSettingsModal}
          aria-label="Open Configuration Matrix"
          className="flex h-8 items-center space-x-1.5 rounded border border-surface-border bg-surface-base px-2.5 text-[11px] font-medium text-text-secondary hover:bg-surface-active hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-steel transition"
          title="Configuration Matrix & Glossary Engine (Cmd/Ctrl+,)"
        >
          <Sliders className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>CONFIG</span>
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

          {/* Background Opacity Slider (0% - 100% solid zinc) */}
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

          {/* Typography Scale Slider (14px - 48px Geist Mono) */}
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

          {/* Line Display Limit Selector (2, 4, 6 sentences) */}
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

          {/* Click-Through Toggle */}
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
