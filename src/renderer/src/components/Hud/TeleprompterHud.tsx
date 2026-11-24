/**
 * DUALAI - Module 3 Teleprompter & Floating Overlay HUD Window (Day 10)
 * Secondary frameless, transparent, alwaysOnTop Electron overlay engineered
 * to float seamlessly above full-screen Zoom, Microsoft Teams, and Google Meet sessions.
 * Features zero-latency opacity & Geist Mono font scaling, line limit selector (2/4/6),
 * click-through toggle via setIgnoreMouseEvents, and persistent localStorage configuration.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  GripHorizontal,
  MousePointerClick,
  X,
  Lock,
  Unlock,
  SlidersHorizontal
} from 'lucide-react'
import { HudSettings, DEFAULT_HUD_SETTINGS } from '../../../../types/settings'
import { TranscriptPayload } from '../../../../types/ipc'

const STORAGE_KEY_HUD = 'dualai_hud_settings'

function loadHudSettings(): HudSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HUD)
    if (!raw) return DEFAULT_HUD_SETTINGS
    return { ...DEFAULT_HUD_SETTINGS, ...(JSON.parse(raw) as Partial<HudSettings>) }
  } catch {
    return DEFAULT_HUD_SETTINGS
  }
}

interface HudLine {
  id: string
  speakerLabel: string
  translatedText: string
  isInterim: boolean
  timestampMs: number
}

export const TeleprompterHud: React.FC = () => {
  const [settings, setSettings] = useState<HudSettings>(loadHudSettings)
  const [showControls, setShowControls] = useState<boolean>(false)
  const [lines, setLines] = useState<HudLine[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Ensure transparent root background for frameless Electron overlay
  useEffect(() => {
    document.documentElement.style.backgroundColor = 'transparent'
    document.body.style.backgroundColor = 'transparent'
  }, [])

  // Persist HUD settings locally and broadcast back to main window
  const updateSettings = useCallback((partial: Partial<HudSettings>) => {
    setSettings((prev) => {
      const next: HudSettings = {
        ...prev,
        ...partial,
        bounds: partial.bounds ? { ...prev.bounds, ...partial.bounds } : prev.bounds
      }

      try {
        localStorage.setItem(STORAGE_KEY_HUD, JSON.stringify(next))
      } catch {
        // Ignore storage errors
      }

      window.electronAPI?.sendHudConfig?.(next)
      if (typeof partial.isClickThrough === 'boolean') {
        void window.electronAPI?.setHudClickThrough?.(partial.isClickThrough)
      }
      return next
    })
  }, [])

  // Subscribe to Main -> HUD IPC transcript streams and remote config changes
  useEffect(() => {
    const cleanups: Array<() => void> = []

    if (window.electronAPI?.onHudTranscript) {
      cleanups.push(
        window.electronAPI.onHudTranscript((payload: TranscriptPayload) => {
          const id = payload.id || `${payload.speakerId}-${payload.timestampMs}`
          const text = payload.translatedText || payload.sourceText
          if (!text) return

          setLines((prev) => {
            const existingIdx = prev.findIndex((item) => item.id === id)
            const nextLine: HudLine = {
              id,
              speakerLabel: payload.speakerLabel,
              translatedText: text,
              isInterim: payload.isInterim,
              timestampMs: payload.timestampMs
            }

            if (existingIdx !== -1) {
              const copy = [...prev]
              copy[existingIdx] = nextLine
              return copy
            }
            return [...prev.slice(-24), nextLine]
          })
        })
      )
    }

    if (window.electronAPI?.onHudConfigUpdate) {
      cleanups.push(
        window.electronAPI.onHudConfigUpdate((remoteConfig: HudSettings) => {
          setSettings(remoteConfig)
          try {
            localStorage.setItem(STORAGE_KEY_HUD, JSON.stringify(remoteConfig))
          } catch {
            // Ignore
          }
        })
      )
    }

    if (window.electronAPI?.onShortcutClearBuffer) {
      cleanups.push(
        window.electronAPI.onShortcutClearBuffer(() => {
          setLines([])
        })
      )
    }

    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [])

  // Auto-scroll smoothly whenever new lines or interim tokens arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines, settings.lineLimit, settings.fontSizePx])

  // Temporarily allow mouse interaction over the slim header bar when click-through is locked
  const handleControlStripEnter = () => {
    if (settings.isClickThrough) {
      void window.electronAPI?.setHudClickThrough?.(false)
    }
  }

  const handleControlStripLeave = () => {
    if (settings.isClickThrough) {
      void window.electronAPI?.setHudClickThrough?.(true)
    }
  }

  const visibleLines = lines.slice(-settings.lineLimit)
  const zincBackground = `rgba(9, 9, 11, ${settings.opacity})`
  const borderAlpha = Math.max(0.25, settings.opacity * 0.9)

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-lg select-none"
      style={{
        backgroundColor: zincBackground,
        border: `1px solid rgba(39, 39, 42, ${borderAlpha})`
      }}
    >
      {/* Frameless Draggable Control Strip */}
      <div
        onMouseEnter={handleControlStripEnter}
        onMouseLeave={handleControlStripLeave}
        className="flex h-8 shrink-0 items-center justify-between border-b px-3 font-mono text-[10px] text-text-secondary"
        style={{
          backgroundColor: `rgba(18, 18, 21, ${Math.max(0.55, settings.opacity)})`,
          borderColor: 'rgba(39, 39, 42, 0.7)',
          // @ts-expect-error Electron WebKit draggable window region
          WebkitAppRegion: 'drag'
        }}
      >
        {/* Drag Grip & Identity */}
        <div className="flex items-center space-x-2">
          <GripHorizontal className="h-3.5 w-3.5 text-text-muted" />
          <span className="font-bold tracking-wider text-text-primary">DUALAI TELEPROMPTER HUD</span>
          <span className="rounded border border-surface-border bg-surface-base/70 px-1.5 py-0.5 text-[9px] text-accent-emerald">
            TOP-MOST
          </span>
        </div>

        {/* Non-Draggable Quick Action Buttons */}
        <div
          className="flex items-center space-x-1.5"
          style={{
            // @ts-expect-error Disable drag on interactive controls
            WebkitAppRegion: 'no-drag'
          }}
        >
          {/* Toggle Inline Sliders Drawer */}
          <button
            type="button"
            onClick={() => setShowControls((prev) => !prev)}
            className={`flex items-center space-x-1 rounded border px-1.5 py-0.5 transition ${
              showControls
                ? 'border-accent-steel bg-accent-steel/20 text-accent-steel'
                : 'border-surface-border bg-surface-base/80 text-text-secondary hover:text-text-primary'
            }`}
            title="Adjust Opacity, Font Scale & Line Limit"
          >
            <SlidersHorizontal className="h-3 w-3" />
            <span>TUNE</span>
          </button>

          {/* Click-Through Lock Toggle */}
          <button
            type="button"
            onClick={() => updateSettings({ isClickThrough: !settings.isClickThrough })}
            className={`flex items-center space-x-1 rounded border px-1.5 py-0.5 font-bold transition ${
              settings.isClickThrough
                ? 'border-accent-amber bg-accent-amber/20 text-accent-amber'
                : 'border-surface-border bg-surface-base/80 text-text-secondary hover:text-text-primary'
            }`}
            title="Toggle Click-Through Mode (setIgnoreMouseEvents)"
          >
            {settings.isClickThrough ? (
              <>
                <Lock className="h-3 w-3" />
                <span>CLICK-THROUGH ON</span>
              </>
            ) : (
              <>
                <Unlock className="h-3 w-3" />
                <span>INTERACTIVE</span>
              </>
            )}
          </button>

          {/* Close HUD */}
          <button
            type="button"
            onClick={() => void window.electronAPI?.closeHud?.()}
            className="rounded p-0.5 text-text-muted hover:bg-accent-crimson/20 hover:text-accent-crimson transition"
            title="Close Teleprompter HUD (Cmd/Ctrl+Shift+H)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Zero-Latency Inline Calibration Strip */}
      {showControls && (
        <div
          onMouseEnter={handleControlStripEnter}
          onMouseLeave={handleControlStripLeave}
          className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border bg-surface-panel/95 px-3 py-2 font-mono text-[10px] text-text-secondary"
        >
          {/* Opacity Slider (0% - 100% Solid Zinc) */}
          <label className="flex items-center space-x-2">
            <span>OPACITY: {Math.round(settings.opacity * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.opacity}
              onChange={(e) => updateSettings({ opacity: parseFloat(e.target.value) })}
              className="w-24 accent-accent-steel cursor-pointer"
            />
          </label>

          {/* Font Scale Slider (14px - 48px Geist Mono) */}
          <label className="flex items-center space-x-2">
            <span>SIZE: {settings.fontSizePx}px</span>
            <input
              type="range"
              min="14"
              max="48"
              step="1"
              value={settings.fontSizePx}
              onChange={(e) => updateSettings({ fontSizePx: parseInt(e.target.value, 10) })}
              className="w-24 accent-accent-steel cursor-pointer"
            />
          </label>

          {/* Line Limit Selector (2, 4, 6 sentences) */}
          <div className="flex items-center space-x-1">
            <span>LINES:</span>
            {([2, 4, 6] as const).map((limit) => (
              <button
                key={limit}
                type="button"
                onClick={() => updateSettings({ lineLimit: limit })}
                className={`rounded border px-1.5 py-0.5 transition ${
                  settings.lineLimit === limit
                    ? 'border-accent-steel bg-accent-steel/25 text-accent-steel font-bold'
                    : 'border-surface-border bg-surface-base text-text-muted hover:text-text-primary'
                }`}
              >
                {limit}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Teleprompter Streaming Canvas */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: `${settings.fontSizePx}px`,
          lineHeight: 1.38
        }}
      >
        {visibleLines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="font-mono text-xs text-text-secondary">
              Teleprompter HUD armed and floating above video calls.
            </p>
            <p className="mt-1 font-mono text-[11px] text-text-muted flex items-center space-x-1">
              <MousePointerClick className="h-3 w-3 inline" />
              <span>
                Showing up to {settings.lineLimit} sentences at {settings.fontSizePx}px Geist Mono.
              </span>
            </p>
          </div>
        ) : (
          visibleLines.map((line, index) => {
            const isNewest = index === visibleLines.length - 1
            return (
              <div
                key={line.id}
                className={`transition-opacity ${isNewest ? 'text-text-primary opacity-100' : 'text-text-secondary opacity-70'}`}
              >
                <span className="mr-2 rounded border border-surface-border bg-surface-base/75 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-accent-emerald">
                  {line.speakerLabel}
                </span>
                <span
                  className="font-medium tracking-tight"
                  style={{
                    textShadow: '0 1px 3px rgba(0, 0, 0, 0.85)'
                  }}
                >
                  {line.translatedText}
                </span>
                {line.isInterim && (
                  <span className="ml-1.5 inline-block h-[0.85em] w-2 align-middle bg-accent-emerald animate-pulse" />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
