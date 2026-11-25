/**
 * DUALAI - Streamlined Live Typography & Conversation Colors Popover (CARD-16)
 * Pure UI/UX-focused reading display controls:
 *  - Font Family (Inter, Geist Mono, System Sans, High-Legibility)
 *  - Font Size (13px to 28px)
 *  - Line Spacing (Compact, Standard, Relaxed)
 *  - Customizable Conversation Colors per Language (1 color per language regardless of speaker count)
 * Synchronizes automatically with the Floating Teleprompter HUD in the background.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Type, RotateCcw, Minus, Plus } from 'lucide-react'
import { SUPPORTED_LANGUAGES } from '../../../../types/language'
import { WorkspaceLineSpacing } from '../../../../types/settings'
import { useSession } from '../../context/SessionContext'
import {
  CONVERSATION_COLOR_PRESETS,
  LINE_SPACING_METRICS,
  MAX_WORKSPACE_FONT_SIZE_PX,
  MIN_WORKSPACE_FONT_SIZE_PX,
  WORKSPACE_FONT_OPTIONS
} from '../../utils/typographyPreferences'

function getNativeLanguageLabel(code: string): string {
  const found = SUPPORTED_LANGUAGES.find((l) => l.code === code)
  return found ? found.nativeName : code.toUpperCase()
}

export const TextPersonalizationPopover: React.FC = () => {
  const {
    sourceLang,
    targetLang,
    workspaceDisplaySettings,
    updateWorkspaceDisplaySettings,
    resetWorkspaceDisplaySettings
  } = useSession()

  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const { fontFamily, fontSizePx, lineSpacing, languageAColor, languageBColor } =
    workspaceDisplaySettings

  const langALabel = getNativeLanguageLabel(sourceLang)
  const langBLabel = getNativeLanguageLabel(targetLang)

  return (
    <div ref={containerRef} className="relative">
      {/* Clean Typography Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="Text and Color Personalization"
        className={`flex h-7 items-center space-x-1.5 rounded border px-2.5 text-[11px] font-medium transition focus:outline-none focus:ring-1 focus:ring-accent-steel ${
          isOpen
            ? 'border-accent-steel bg-accent-steel/15 text-text-primary'
            : 'border-surface-border bg-surface-panel text-text-secondary hover:bg-surface-active hover:text-text-primary'
        }`}
        title="Customize font family, size (13px-28px), line spacing, and conversation colors"
      >
        <Type className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>Text</span>
        <span className="font-mono text-[10px] text-text-muted">{fontSizePx}px</span>
      </button>

      {/* Pure UI/UX Typography & Conversation Color Popover */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Typography and Conversation Colors"
          className="absolute right-0 top-9 z-40 w-[308px] rounded-lg border border-surface-border bg-surface-panel p-4 text-xs text-text-primary shadow-2xl space-y-4"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-surface-border pb-2.5">
            <div>
              <h3 className="text-xs font-semibold tracking-tight text-text-primary">
                Text & Colors
              </h3>
              <p className="text-[10px] text-text-muted">
                Saved automatically across sessions
              </p>
            </div>
            <button
              type="button"
              onClick={resetWorkspaceDisplaySettings}
              className="flex items-center space-x-1 rounded border border-surface-border bg-surface-base px-2 py-1 font-mono text-[10px] text-text-secondary hover:bg-surface-active hover:text-text-primary transition"
              title="Reset text and color defaults"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* 1. Font Family */}
          <div className="space-y-1.5">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-text-muted">
              Font Family
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {WORKSPACE_FONT_OPTIONS.map((opt) => {
                const active = fontFamily === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateWorkspaceDisplaySettings({ fontFamily: opt.id })}
                    style={{ fontFamily: opt.cssStack, letterSpacing: opt.letterSpacing }}
                    className={`rounded border px-2.5 py-1.5 text-left text-[11px] transition ${
                      active
                        ? 'border-accent-steel bg-accent-steel/15 text-text-primary font-semibold'
                        : 'border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. Font Size (13px to 28px) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Font Size
              </span>
              <span className="font-mono text-[11px] font-semibold text-text-primary">
                {fontSizePx}px
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                aria-label="Decrease font size"
                disabled={fontSizePx <= MIN_WORKSPACE_FONT_SIZE_PX}
                onClick={() => updateWorkspaceDisplaySettings({ fontSizePx: fontSizePx - 1 })}
                className="flex h-6 w-6 items-center justify-center rounded border border-surface-border bg-surface-base text-text-secondary hover:text-text-primary disabled:opacity-40"
              >
                <Minus className="h-3 w-3" />
              </button>
              <input
                type="range"
                aria-label="Workspace font size in pixels"
                min={MIN_WORKSPACE_FONT_SIZE_PX}
                max={MAX_WORKSPACE_FONT_SIZE_PX}
                step={1}
                value={fontSizePx}
                onChange={(e) =>
                  updateWorkspaceDisplaySettings({ fontSizePx: parseInt(e.target.value, 10) })
                }
                className="flex-1 accent-accent-steel cursor-pointer"
              />
              <button
                type="button"
                aria-label="Increase font size"
                disabled={fontSizePx >= MAX_WORKSPACE_FONT_SIZE_PX}
                onClick={() => updateWorkspaceDisplaySettings({ fontSizePx: fontSizePx + 1 })}
                className="flex h-6 w-6 items-center justify-center rounded border border-surface-border bg-surface-base text-text-secondary hover:text-text-primary disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* 3. Line Spacing */}
          <div className="space-y-1.5">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-text-muted">
              Line Spacing
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['compact', 'standard', 'relaxed'] as WorkspaceLineSpacing[]).map((spacingId) => {
                const active = lineSpacing === spacingId
                return (
                  <button
                    key={spacingId}
                    type="button"
                    onClick={() => updateWorkspaceDisplaySettings({ lineSpacing: spacingId })}
                    className={`rounded border px-2 py-1.5 text-[11px] font-medium transition ${
                      active
                        ? 'border-accent-steel bg-accent-steel/15 text-text-primary'
                        : 'border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary'
                    }`}
                  >
                    {LINE_SPACING_METRICS[spacingId].label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 4. Conversation Language Colors (1 Consistent Color Per Language) */}
          <div className="space-y-3 border-t border-surface-border pt-3">
            <span className="block font-mono text-[10px] uppercase tracking-wider text-text-muted">
              Conversation Colors
            </span>

            <LanguageColorRow
              label={langALabel}
              value={languageAColor}
              onChange={(hex) => updateWorkspaceDisplaySettings({ languageAColor: hex })}
            />

            <LanguageColorRow
              label={langBLabel}
              value={languageBColor}
              onChange={(hex) => updateWorkspaceDisplaySettings({ languageBColor: hex })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface LanguageColorRowProps {
  label: string
  value: string
  onChange: (hex: string) => void
}

const LanguageColorRow: React.FC<LanguageColorRowProps> = ({ label, value, onChange }) => {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center space-x-2 min-w-0">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
          style={{ backgroundColor: value }}
        />
        <span className="truncate text-[11px] font-medium text-text-secondary">{label}</span>
      </div>

      <div className="flex items-center space-x-1.5">
        {CONVERSATION_COLOR_PRESETS.map((preset) => {
          const selected = value.toLowerCase() === preset.hex.toLowerCase()
          return (
            <button
              key={preset.hex}
              type="button"
              onClick={() => onChange(preset.hex)}
              aria-label={`Set ${label} color to ${preset.label}`}
              title={`${label}: ${preset.label}`}
              className={`h-4 w-4 rounded-full border transition ${
                selected
                  ? 'border-white scale-110 ring-1 ring-accent-steel'
                  : 'border-surface-border hover:scale-110'
              }`}
              style={{ backgroundColor: preset.hex }}
            />
          )
        })}

        <label
          className="relative flex h-5 w-5 cursor-pointer items-center justify-center overflow-hidden rounded border border-surface-border bg-surface-base"
          title={`Custom color for ${label}`}
        >
          <input
            type="color"
            aria-label={`Custom hex color for ${label}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <span
            className="h-3 w-3 rounded-sm"
            style={{ backgroundColor: value }}
          />
        </label>
      </div>
    </div>
  )
}
