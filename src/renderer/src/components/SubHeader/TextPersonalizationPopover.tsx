/**
 * DUALAI - Live Typography & Conversation Colors Popover (Apple Liquid Glass)
 * Pure reading display controls:
 *  - Font Family (Inter, Geist Mono, System Sans, High-Legibility)
 *  - Font Size (13px to 28px)
 *  - Line Spacing (Compact, Standard, Relaxed)
 *  - Customizable Conversation Colors per Language (1 color per language)
 * Synchronizes automatically with the Floating Teleprompter HUD.
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
import { GlassSegmentedControl } from '../UI/GlassSegmentedControl'
import { GlassTooltip } from '../UI/GlassTooltip'

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
    <div ref={containerRef} className="relative" data-tour-id="typography">
      <GlassTooltip
        label="Text & Colors"
        description={`Font, size (${fontSizePx}px), spacing & language colors`}
        disabled={isOpen}
      >
        <button
          type="button"
          data-toolbar-item="true"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label="Text and Color Personalization"
          className={`glass-control-hover flex h-7 items-center space-x-1 rounded-full px-2 text-[11px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 ${
            isOpen ? 'bg-white/[0.15] text-white' : 'text-white/75 hover:text-white'
          }`}
        >
          <Type className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="hidden 2xl:inline tabular-nums text-[10px] text-white/65">
            {fontSizePx}px
          </span>
        </button>
      </GlassTooltip>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Typography and Conversation Colors"
          className="glass-sheet animate-glass-pop absolute right-0 top-10 z-50 w-[318px] rounded-[22px] p-4 text-xs text-text-primary space-y-4"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-1">
            <div>
              <h3 className="text-[13px] font-semibold tracking-tight text-white">
                Typography & Colors
              </h3>
              <p className="text-[10px] text-white/45">Synced live with workspace and HUD</p>
            </div>
            <button
              type="button"
              onClick={resetWorkspaceDisplaySettings}
              className="glass-control-hover flex items-center space-x-1 rounded-full bg-white/[0.07] border border-white/[0.09] px-2.5 py-1 text-[10px] font-medium text-white/75 hover:text-white"
              title="Reset text and color defaults"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* 1. Font Family */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-white/55">Font Family</div>
            <div className="grid grid-cols-2 gap-1.5">
              {WORKSPACE_FONT_OPTIONS.map((opt) => {
                const active = fontFamily === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateWorkspaceDisplaySettings({ fontFamily: opt.id })}
                    className={`glass-control-hover flex flex-col items-start rounded-xl border px-2.5 py-2 text-left ${
                      active
                        ? 'border-accent-steel/55 bg-accent-steel/18 text-white'
                        : 'border-white/[0.06] bg-white/[0.04] text-white/70 hover:text-white'
                    }`}
                  >
                    <span
                      className="text-xs font-medium leading-tight"
                      style={{ fontFamily: opt.cssStack }}
                    >
                      {opt.label}
                    </span>
                    <span
                      className="mt-0.5 text-[10px] text-white/40"
                      style={{ fontFamily: opt.cssStack }}
                    >
                      Aa Bb 123
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 2. Font Size */}
          <div className="glass-grouped-card rounded-2xl p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-white/70">Text Size</span>
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  onClick={() =>
                    updateWorkspaceDisplaySettings({
                      fontSizePx: Math.max(MIN_WORKSPACE_FONT_SIZE_PX, fontSizePx - 1)
                    })
                  }
                  disabled={fontSizePx <= MIN_WORKSPACE_FONT_SIZE_PX}
                  aria-label="Decrease font size"
                  className="glass-control-hover flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-white/80 disabled:opacity-30"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-10 text-center font-mono text-[11px] font-semibold tabular-nums text-white">
                  {fontSizePx}px
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateWorkspaceDisplaySettings({
                      fontSizePx: Math.min(MAX_WORKSPACE_FONT_SIZE_PX, fontSizePx + 1)
                    })
                  }
                  disabled={fontSizePx >= MAX_WORKSPACE_FONT_SIZE_PX}
                  aria-label="Increase font size"
                  className="glass-control-hover flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.08] text-white/80 disabled:opacity-30"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min={MIN_WORKSPACE_FONT_SIZE_PX}
              max={MAX_WORKSPACE_FONT_SIZE_PX}
              step={1}
              value={fontSizePx}
              onChange={(e) =>
                updateWorkspaceDisplaySettings({ fontSizePx: parseInt(e.target.value, 10) })
              }
              aria-label="Workspace font size slider"
              className="apple-slider w-full"
            />
          </div>

          {/* 3. Line Spacing */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-white/55">Line Spacing</span>
            <GlassSegmentedControl<WorkspaceLineSpacing>
              ariaLabel="Line Spacing"
              value={lineSpacing}
              onChange={(val) => updateWorkspaceDisplaySettings({ lineSpacing: val })}
              options={(Object.keys(LINE_SPACING_METRICS) as WorkspaceLineSpacing[]).map((key) => ({
                id: key,
                label: LINE_SPACING_METRICS[key].label
              }))}
            />
          </div>

          {/* 4. Conversation Colors per Language */}
          <div className="glass-grouped-card rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-white/75">Conversation Colors</span>
              <span className="text-[10px] text-white/40">1 color per language</span>
            </div>

            {/* Source Language Color */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center space-x-2 text-white/80">
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-1 ring-white/25"
                    style={{ backgroundColor: languageAColor }}
                  />
                  <span>{langALabel}</span>
                </span>
                <label className="flex items-center space-x-1.5 cursor-pointer text-[10px] font-mono text-white/50 hover:text-white">
                  <span>{languageAColor}</span>
                  <input
                    type="color"
                    value={languageAColor}
                    onChange={(e) =>
                      updateWorkspaceDisplaySettings({ languageAColor: e.target.value })
                    }
                    aria-label={`Custom color for ${langALabel}`}
                    className="h-4 w-4 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  />
                </label>
              </div>
              <div className="flex items-center justify-between gap-1.5">
                {CONVERSATION_COLOR_PRESETS.map((preset) => {
                  const selected = languageAColor.toLowerCase() === preset.hex.toLowerCase()
                  return (
                    <button
                      key={`langA-${preset.hex}`}
                      type="button"
                      onClick={() => updateWorkspaceDisplaySettings({ languageAColor: preset.hex })}
                      title={`${langALabel}: ${preset.label}`}
                      aria-label={`${langALabel} color ${preset.label}`}
                      className={`h-5 w-5 rounded-full transition-transform duration-150 hover:scale-110 ${
                        selected ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1c1c22]' : 'ring-1 ring-white/20'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                    />
                  )
                })}
              </div>
            </div>

            <div className="h-px w-full bg-white/[0.06]" />

            {/* Target Language Color */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center space-x-2 text-white/80">
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-1 ring-white/25"
                    style={{ backgroundColor: languageBColor }}
                  />
                  <span>{langBLabel}</span>
                </span>
                <label className="flex items-center space-x-1.5 cursor-pointer text-[10px] font-mono text-white/50 hover:text-white">
                  <span>{languageBColor}</span>
                  <input
                    type="color"
                    value={languageBColor}
                    onChange={(e) =>
                      updateWorkspaceDisplaySettings({ languageBColor: e.target.value })
                    }
                    aria-label={`Custom color for ${langBLabel}`}
                    className="h-4 w-4 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  />
                </label>
              </div>
              <div className="flex items-center justify-between gap-1.5">
                {CONVERSATION_COLOR_PRESETS.map((preset) => {
                  const selected = languageBColor.toLowerCase() === preset.hex.toLowerCase()
                  return (
                    <button
                      key={`langB-${preset.hex}`}
                      type="button"
                      onClick={() => updateWorkspaceDisplaySettings({ languageBColor: preset.hex })}
                      title={`${langBLabel}: ${preset.label}`}
                      aria-label={`${langBLabel} color ${preset.label}`}
                      className={`h-5 w-5 rounded-full transition-transform duration-150 hover:scale-110 ${
                        selected ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1c1c22]' : 'ring-1 ring-white/20'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
