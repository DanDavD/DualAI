/**
 * DUALAI - Compact Floating Mini View Overlay (Apple Liquid Glass)
 * Frameless, translucent, alwaysOnTop Electron overlay engineered for pure reading clarity
 * above full-screen Zoom, Microsoft Teams, and Google Meet sessions at any window size.
 * Features an auto-hiding floating glass pill and a compact right-anchored settings submenu
 * with live Text Color picker, Opacity, Text Size, Visible Lines, Spacing, Font & Click-Through.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  GripHorizontal,
  X,
  Lock,
  Unlock,
  Settings,
  PictureInPicture2,
  Trash2
} from 'lucide-react'
import {
  HudSettings,
  DEFAULT_HUD_SETTINGS,
  DEFAULT_WORKSPACE_DISPLAY_SETTINGS,
  WorkspaceLineSpacing
} from '../../../../types/settings'
import { TranscriptPayload } from '../../../../types/ipc'
import {
  CONVERSATION_COLOR_PRESETS,
  STORAGE_KEY_WORKSPACE_DISPLAY,
  WORKSPACE_FONT_OPTIONS,
  mergeWorkspaceTypographyIntoHud,
  resolveFontFamilyCss,
  resolveLineSpacingMetrics,
  sanitizeWorkspaceDisplaySettings
} from '../../utils/typographyPreferences'
import { AppleSwitch } from '../UI/AppleSwitch'
import { formatPlatformShortcut, isWindows } from '../../utils/platform'

const STORAGE_KEY_HUD = 'dualai_hud_settings'

const SHORT_FONT_LABELS: Record<string, string> = {
  system_sans: 'SF Pro',
  inter: 'Avenir',
  geist_mono: 'Mono',
  high_legibility: 'Serif'
}

const SHORT_SPACING_LABELS: Record<WorkspaceLineSpacing, string> = {
  compact: 'Tight',
  standard: 'Std',
  relaxed: 'Wide'
}

function loadHudSettings(): HudSettings {
  let baseHud: HudSettings = DEFAULT_HUD_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HUD)
    if (raw) {
      baseHud = { ...DEFAULT_HUD_SETTINGS, ...(JSON.parse(raw) as Partial<HudSettings>) }
    }
  } catch {
    baseHud = DEFAULT_HUD_SETTINGS
  }

  // Always inherit the active Compact Stacked / Dual Pane typography & colors on boot
  try {
    const rawWorkspace = localStorage.getItem(STORAGE_KEY_WORKSPACE_DISPLAY)
    if (rawWorkspace) {
      const workspace = sanitizeWorkspaceDisplaySettings(JSON.parse(rawWorkspace))
      return mergeWorkspaceTypographyIntoHud(baseHud, workspace)
    }
  } catch {
    // Ignore storage errors
  }
  return mergeWorkspaceTypographyIntoHud(baseHud, DEFAULT_WORKSPACE_DISPLAY_SETTINGS)
}

interface HudLine {
  id: string
  speakerLabel: string
  sourceText: string
  translatedText: string
  originalColor?: string
  translationColor?: string
  isInterim: boolean
  timestampMs: number
}

export const TeleprompterHud: React.FC = () => {
  const [settings, setSettings] = useState<HudSettings>(loadHudSettings)
  const [showControls, setShowControls] = useState<boolean>(false)
  const [isHovered, setIsHovered] = useState<boolean>(false)
  const [lines, setLines] = useState<HudLine[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    document.documentElement.style.backgroundColor = 'transparent'
    document.body.style.backgroundColor = 'transparent'
  }, [])

  // Close compact settings submenu on outside click or Escape
  useEffect(() => {
    if (!showControls) return
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        submenuRef.current &&
        !submenuRef.current.contains(target) &&
        settingsBtnRef.current &&
        !settingsBtnRef.current.contains(target)
      ) {
        setShowControls(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowControls(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [showControls])

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

  useEffect(() => {
    const cleanups: Array<() => void> = []

    if (window.electronAPI?.onHudTranscript) {
      cleanups.push(
        window.electronAPI.onHudTranscript((payload: TranscriptPayload) => {
          const id = payload.id || `${payload.speakerId}-${payload.timestampMs}`
          const cleanSource = (payload.sourceText || '').trim()
          const cleanTranslated = (payload.translatedText || '').trim()
          if (!cleanSource && !cleanTranslated) return

          setLines((prev) => {
            const existingIdx = prev.findIndex((item) => item.id === id)
            const prevItem = existingIdx !== -1 ? prev[existingIdx] : undefined
            const nextLine: HudLine = {
              id,
              speakerLabel: payload.speakerLabel || prevItem?.speakerLabel || 'Speaker 1',
              sourceText: cleanSource || prevItem?.sourceText || '',
              translatedText: cleanTranslated || prevItem?.translatedText || '',
              originalColor: payload.originalColor || prevItem?.originalColor,
              translationColor: payload.translationColor || prevItem?.translationColor,
              isInterim: payload.isInterim,
              timestampMs: payload.timestampMs || prevItem?.timestampMs || Date.now()
            }

            if (existingIdx !== -1) {
              const copy = [...prev]
              copy[existingIdx] = nextLine
              return copy
            }
            return [...prev.slice(-39), nextLine]
          })
        })
      )
    }

    if (window.electronAPI?.onHudConfigUpdate) {
      cleanups.push(
        window.electronAPI.onHudConfigUpdate((remoteConfig: HudSettings) => {
          setSettings((prevSettings) => {
            const prevA = (prevSettings.languageAColor || '#ffffff').toLowerCase()
            const prevB = (prevSettings.languageBColor || prevSettings.textColor || '#ffaa00').toLowerCase()
            const nextA = remoteConfig.languageAColor || prevSettings.languageAColor || '#ffffff'
            const nextB = remoteConfig.languageBColor || remoteConfig.textColor || prevSettings.languageBColor || '#ffaa00'
            if (prevA !== nextA.toLowerCase() || prevB !== nextB.toLowerCase()) {
              setLines((prevLines) =>
                prevLines.map((line) => ({
                  ...line,
                  originalColor:
                    line.originalColor?.toLowerCase() === prevB ? nextB : nextA,
                  translationColor:
                    line.translationColor?.toLowerCase() === prevA ? nextA : nextB
                }))
              )
            }
            return remoteConfig
          })
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines, settings.lineLimit, settings.fontSizePx])

  const handleControlStripEnter = () => {
    setIsHovered(true)
    if (settings.isClickThrough) {
      void window.electronAPI?.setHudClickThrough?.(false)
    }
  }

  const handleControlStripLeave = () => {
    setIsHovered(false)
    if (settings.isClickThrough) {
      void window.electronAPI?.setHudClickThrough?.(true)
    }
  }

  const visibleLines = lines.slice(-settings.lineLimit)
  const zincBackground = `rgba(9, 9, 11, ${settings.opacity})`
  const borderAlpha = Math.max(0.12, settings.opacity * 0.24)
  const fontMetrics = resolveFontFamilyCss(settings.fontFamily || 'inter')
  const lineMetrics = resolveLineSpacingMetrics(settings.lineSpacing || 'standard')
  const isHighContrast = Boolean(settings.highContrast)
  const showSpeakers = settings.showSpeakerLabels ?? false
  const showTimes = Boolean(settings.showTimestamps)
  const defaultOriginalColor = settings.languageAColor || '#ffffff'
  const defaultTranslationColor = settings.languageBColor || settings.textColor || '#ffaa00'
  const activeTextColor = defaultTranslationColor
  const showChrome = isHovered || showControls || visibleLines.length === 0

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative flex h-screen w-screen flex-col overflow-hidden rounded-[22px] select-none font-sans"
      style={{
        backgroundColor:
          isWindows && settings.opacity > 0.04
            ? `rgba(11, 11, 14, ${Math.min(0.96, settings.opacity * 1.15).toFixed(2)})`
            : zincBackground,
        backdropFilter: !isWindows && settings.opacity > 0.04 ? 'blur(34px) saturate(185%)' : 'none',
        WebkitBackdropFilter:
          !isWindows && settings.opacity > 0.04 ? 'blur(34px) saturate(185%)' : 'none',
        border: `1px solid rgba(255, 255, 255, ${borderAlpha})`,
        boxShadow:
          settings.opacity > 0.04
            ? 'inset 0 1px 0.5px rgba(255, 255, 255, 0.16), 0 18px 44px -8px rgba(0, 0, 0, 0.62)'
            : 'none'
      }}
    >
      {/* Floating Minimalist Auto-Hiding Top Capsules */}
      <div
        onMouseEnter={handleControlStripEnter}
        onMouseLeave={handleControlStripLeave}
        className={`absolute top-2.5 left-3 right-3 z-30 flex items-center justify-between gap-2 transition-opacity duration-200 ${
          showChrome ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Left Drag Pill (Apply WebkitAppRegion drag strictly to the pill so Windows hover events fire cleanly) */}
        <div
          className="glass-capsule flex h-7 items-center space-x-1.5 rounded-full px-2.5 text-[11px] text-white/80"
          style={{
            // @ts-expect-error Electron WebKit draggable window region
            WebkitAppRegion: 'drag'
          }}
        >
          <GripHorizontal className="h-3.5 w-3.5 text-white/45 shrink-0" />
          <span className="font-semibold tracking-tight text-white/90 whitespace-nowrap">
            DualAI
          </span>
          {settings.isClickThrough && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent-steel shrink-0"
              title="Click-through active"
            />
          )}
        </div>

        {/* Right Floating Action Capsule */}
        <div
          className="glass-capsule flex h-7 items-center space-x-0.5 rounded-full p-0.5"
          style={{
            // @ts-expect-error Disable drag on interactive controls
            WebkitAppRegion: 'no-drag'
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur()
              updateSettings({ isClickThrough: !settings.isClickThrough })
            }}
            title={
              settings.isClickThrough
                ? 'Click-through ON (clicks pass behind)'
                : 'Click-through OFF (interactive)'
            }
            aria-label="Toggle Click-Through Mode"
            className={`glass-control-hover flex h-6 items-center space-x-1 rounded-full px-2 text-[10px] font-medium focus:outline-none ${
              settings.isClickThrough
                ? 'bg-accent-steel/22 text-accent-steel border border-accent-steel/45'
                : 'text-white/70 hover:text-white'
            }`}
          >
            {settings.isClickThrough ? (
              <Lock className="h-3 w-3 shrink-0" />
            ) : (
              <Unlock className="h-3 w-3 shrink-0" />
            )}
            <span className="hidden sm:inline">
              {settings.isClickThrough ? 'Pass-Through' : 'Interactive'}
            </span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur()
              setLines([])
            }}
            title="Clear Mini View text"
            aria-label="Clear Mini View text"
            className="glass-control-hover flex h-6 w-6 items-center justify-center rounded-full text-white/65 hover:bg-white/[0.14] hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>

          <button
            ref={settingsBtnRef}
            type="button"
            onClick={() => setShowControls((prev) => !prev)}
            title="Mini View Settings"
            aria-label="Mini View Settings"
            aria-expanded={showControls}
            className={`glass-control-hover flex h-6 w-6 items-center justify-center rounded-full ${
              showControls ? 'bg-white/[0.18] text-white' : 'text-white/70 hover:text-white'
            }`}
          >
            <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => void window.electronAPI?.closeHud?.()}
            title={`Close Mini View (${formatPlatformShortcut('CommandOrControl+Shift+H')})`}
            aria-label="Close Mini View"
            className="glass-control-hover flex h-6 w-6 items-center justify-center rounded-full text-white/60 hover:bg-accent-crimson/25 hover:text-accent-crimson"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.85} />
          </button>
        </div>
      </div>

      {/* Compact Right-Anchored Settings Submenu Popover (Live Preview Remains Visible!) */}
      {showControls && (
        <div
          ref={submenuRef}
          role="dialog"
          aria-label="Mini View Settings Submenu"
          onMouseEnter={handleControlStripEnter}
          onMouseLeave={handleControlStripLeave}
          className="glass-sheet animate-glass-pop absolute right-3 top-11 z-30 w-[264px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-54px)] overflow-y-auto rounded-[18px] p-3 text-[11px] space-y-2.5"
          style={{
            // @ts-expect-error Disable drag inside submenu
            WebkitAppRegion: 'no-drag'
          }}
        >
          {/* 1. Text Color Swatches + Custom Color Picker */}
          <div className="glass-grouped-card rounded-xl px-2.5 py-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-white/60">Text Color</span>
              <label className="flex items-center space-x-1 cursor-pointer font-mono text-[9px] text-white/50 hover:text-white">
                <span>{activeTextColor}</span>
                <input
                  type="color"
                  value={activeTextColor}
                  onChange={(e) => updateSettings({ textColor: e.target.value })}
                  aria-label="Custom Mini View text color"
                  className="h-3.5 w-3.5 cursor-pointer rounded-full border-0 bg-transparent p-0"
                />
              </label>
            </div>
            <div className="flex items-center justify-between gap-1">
              {CONVERSATION_COLOR_PRESETS.map((preset) => {
                const selected = activeTextColor.toLowerCase() === preset.hex.toLowerCase()
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => updateSettings({ textColor: preset.hex })}
                    title={preset.label}
                    aria-label={`Text color ${preset.label}`}
                    className={`h-4 w-4 rounded-full transition-transform duration-150 hover:scale-110 ${
                      selected
                        ? 'ring-2 ring-white ring-offset-1 ring-offset-[#16161b]'
                        : 'ring-1 ring-white/20'
                    }`}
                    style={{ backgroundColor: preset.hex }}
                  />
                )
              })}
            </div>
          </div>

          {/* 2. Compact Opacity & Font Size Sliders */}
          <div className="glass-grouped-card rounded-xl px-2.5 py-2 space-y-2">
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-white/60">Glass</span>
                <span className="font-mono tabular-nums text-white">
                  {Math.round(settings.opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.opacity}
                onChange={(e) => updateSettings({ opacity: parseFloat(e.target.value) })}
                className="apple-slider w-full"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-white/60">Size</span>
                <span className="font-mono tabular-nums text-white">{settings.fontSizePx}px</span>
              </div>
              <input
                type="range"
                min="14"
                max="48"
                step="1"
                value={settings.fontSizePx}
                onChange={(e) => updateSettings({ fontSizePx: parseInt(e.target.value, 10) })}
                className="apple-slider w-full"
              />
            </div>
          </div>

          {/* 3. Compact Lines & Spacing Pills */}
          <div className="glass-grouped-card rounded-xl px-2.5 py-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/60">Lines</span>
              <div className="flex items-center space-x-0.5 rounded-full bg-white/[0.07] p-0.5">
                {([2, 4, 6] as const).map((limit) => (
                  <button
                    key={limit}
                    type="button"
                    onClick={() => updateSettings({ lineLimit: limit })}
                    className={`h-5 w-6 rounded-full text-[10px] font-medium transition ${
                      settings.lineLimit === limit
                        ? 'bg-white text-zinc-950 font-semibold'
                        : 'text-white/55 hover:text-white'
                    }`}
                  >
                    {limit}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/60">Spacing</span>
              <div className="flex items-center space-x-0.5 rounded-full bg-white/[0.07] p-0.5">
                {(['compact', 'standard', 'relaxed'] as WorkspaceLineSpacing[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateSettings({ lineSpacing: key })}
                    className={`h-5 rounded-full px-2 text-[10px] font-medium transition ${
                      (settings.lineSpacing || 'standard') === key
                        ? 'bg-white/[0.2] text-white'
                        : 'text-white/55 hover:text-white'
                    }`}
                  >
                    {SHORT_SPACING_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4. Compact Font Chips */}
          <div className="grid grid-cols-4 gap-1">
            {WORKSPACE_FONT_OPTIONS.map((opt) => {
              const active = (settings.fontFamily || 'inter') === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => updateSettings({ fontFamily: opt.id })}
                  style={{ fontFamily: opt.cssStack }}
                  className={`glass-control-hover rounded-lg border py-1 text-center text-[10px] font-medium ${
                    active
                      ? 'border-accent-steel/55 bg-accent-steel/22 text-white'
                      : 'border-white/[0.08] bg-white/[0.04] text-white/60 hover:text-white'
                  }`}
                >
                  {SHORT_FONT_LABELS[opt.id] || opt.label}
                </button>
              )
            })}
          </div>

          {/* 5. Compact Switches */}
          <div className="glass-grouped-card rounded-xl divide-y divide-white/[0.06] px-2.5">
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[10px] text-white/80">Click-Through</span>
              <AppleSwitch
                checked={settings.isClickThrough}
                onChange={(next) => updateSettings({ isClickThrough: next })}
                ariaLabel="Toggle Click-Through"
              />
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[10px] text-white/80">Speaker Tags</span>
              <AppleSwitch
                checked={showSpeakers}
                onChange={(next) => updateSettings({ showSpeakerLabels: next })}
                ariaLabel="Toggle Speaker Tags"
              />
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-[10px] text-white/80">Timestamps</span>
              <AppleSwitch
                checked={showTimes}
                onChange={(next) => updateSettings({ showTimestamps: next })}
                ariaLabel="Toggle Timestamps"
              />
            </div>
          </div>
        </div>
      )}

      {/* 100% Pure Compact Stacked Live Reading Canvas (Original above, Translation below) */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-4 sm:px-6 pb-4 space-y-2.5 transition-all duration-200 ${
          showChrome ? 'pt-11' : 'pt-4'
        }`}
        style={{
          fontFamily: fontMetrics.fontFamily,
          letterSpacing: fontMetrics.letterSpacing,
          fontSize: `${settings.fontSizePx}px`,
          lineHeight: lineMetrics.lineHeight
        }}
      >
        {visibleLines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center px-3">
            <div className="glass-capsule-subtle mb-2 flex h-8 w-8 items-center justify-center rounded-2xl">
              <PictureInPicture2 className="h-4 w-4 text-accent-steel" strokeWidth={1.75} />
            </div>
            <p
              className="font-medium tracking-tight"
              style={{
                color: defaultOriginalColor,
                fontSize: `${Math.min(22, Math.max(13, settings.fontSizePx))}px`
              }}
            >
              Mini View ready
            </p>
            <p className="mt-1 text-xs text-white/45 max-w-[280px] leading-snug">
              Original speech appears above and translation right below, synced with your workspace style.
            </p>
          </div>
        ) : (
          visibleLines.map((line, index) => {
            const isNewest = index === visibleLines.length - 1
            const formattedTime = new Date(line.timestampMs).toLocaleTimeString([], {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit'
            })
            const rowOriginalColor = line.originalColor || defaultOriginalColor
            const rowTranslationColor = line.translationColor || defaultTranslationColor
            return (
              <div
                key={line.id}
                className="animate-utterance border-b border-white/[0.06] pb-2 last:border-b-0 space-y-0.5 transition-opacity duration-200"
                style={{
                  opacity: isHighContrast ? (isNewest ? 1 : 0.88) : isNewest ? 1 : 0.78
                }}
              >
                {line.sourceText && (
                  <div
                    className={isHighContrast ? 'font-medium tracking-tight' : 'font-normal tracking-tight'}
                    style={{
                      color: rowOriginalColor,
                      textShadow: '0 1px 4px rgba(0, 0, 0, 0.78)'
                    }}
                  >
                    {showSpeakers && (
                      <span className="mr-2 rounded-full bg-white/[0.1] border border-white/[0.12] px-2 py-0.5 align-middle text-[10px] font-medium text-accent-steel">
                        {line.speakerLabel}
                      </span>
                    )}
                    {showTimes && (
                      <span className="mr-2 align-middle font-mono text-[10px] tabular-nums text-white/45">
                        {formattedTime}
                      </span>
                    )}
                    <span>{line.sourceText}</span>
                    {line.isInterim && !line.translatedText && (
                      <span className="ml-1.5 inline-block h-[0.75em] w-1.5 rounded-full align-middle bg-accent-steel animate-pulse" />
                    )}
                  </div>
                )}

                {line.translatedText ? (
                  <div
                    className={isHighContrast ? 'font-semibold tracking-tight' : 'font-medium tracking-tight'}
                    style={{
                      color: rowTranslationColor,
                      textShadow: '0 1px 4px rgba(0, 0, 0, 0.78)'
                    }}
                  >
                    {line.translatedText}
                  </div>
                ) : line.isInterim ? (
                  <div className="text-[0.82em] italic text-white/35">Translating...</div>
                ) : (
                  <div className="text-[0.82em] italic text-white/30">Translation unavailable</div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
