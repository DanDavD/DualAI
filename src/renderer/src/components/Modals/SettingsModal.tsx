/**
 * DUALAI - Consumer-Friendly macOS System Settings Modal
 * Clean, plain-English settings organized strictly around everyday user experience:
 *  - Audio: Call Audio Source, Speakers, Self-Voice Echo Blocker, Volume & Test Audio
 *  - Reading & HUD: Layout style, Font family & size, Line spacing, Teleprompter controls
 *  - Shortcuts: Everyday keyboard shortcuts with one-click rebind
 *  - Privacy & Account: Plain-English privacy guarantees (ZDR / HIPAA / GDPR) & Account link
 * Zero developer jargon, zero API key confusion, zero CSV/JSON export clutter.
 */

import React, { useState, useEffect } from 'react'
import {
  X,
  Volume2,
  Type,
  Keyboard,
  ShieldCheck,
  RotateCcw,
  Columns2,
  Rows2,
  MousePointerClick,
  ArrowRight,
  ArrowRightLeft,
  Sparkles,
  Check
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import {
  ShortcutActionId,
  WorkspaceLineSpacing,
  WorkspaceViewMode
} from '../../../../types/settings'
import { DomainId, DOMAIN_PRESETS } from '../../../../types/domain'
import { OperatingMode } from '../../../../types/audio'
import {
  LINE_SPACING_METRICS,
  MAX_WORKSPACE_FONT_SIZE_PX,
  MIN_WORKSPACE_FONT_SIZE_PX,
  VIEW_MODE_OPTIONS,
  WORKSPACE_FONT_OPTIONS
} from '../../utils/typographyPreferences'
import { AppleSwitch } from '../UI/AppleSwitch'
import { GlassSegmentedControl } from '../UI/GlassSegmentedControl'
import { formatPlatformShortcut } from '../../utils/platform'

type SettingsTabId = 'audio' | 'interpretation' | 'reading' | 'shortcuts' | 'privacy'

interface EnumeratedDevice {
  deviceId: string
  label: string
  kind: 'audioinput' | 'audiooutput'
}

const VIEW_ICONS: Record<
  WorkspaceViewMode,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  dual: Columns2,
  stacked: Rows2
}

const VIRTUAL_LOOPBACK_REGEX =
  /blackhole|loopback|vb-cable|cable output|soundflower|stereo mix|voicemeeter|virtual/i

export const SettingsModal: React.FC = () => {
  const {
    isSettingsModalOpen,
    closeSettingsModal,
    gainChannelB,
    setGainChannelB,
    vadThreshold,
    setVadThreshold,
    selectedLoopbackDeviceId,
    selectedOutputDeviceId,
    setSelectedLoopbackDeviceId,
    setSelectedOutputDeviceId,
    playHardwareCalibrationTone,
    workspaceDisplaySettings,
    updateWorkspaceDisplaySettings,
    resetWorkspaceDisplaySettings,
    hudSettings,
    updateHudSettings,
    shortcutBindings,
    updateShortcutBinding,
    resetShortcutBindings,
    quotaRemainingHours,
    authSession,
    isGatewayAuthenticated,
    openAccountModal,
    domainId,
    setDomainId,
    operatingMode,
    setOperatingMode,
    settingsInitialTab,
    startProductTour
  } = useSession()

  const [activeTab, setActiveTab] = useState<SettingsTabId>(settingsInitialTab || 'audio')
  const [devices, setDevices] = useState<EnumeratedDevice[]>([])
  const [recordingActionId, setRecordingActionId] = useState<ShortcutActionId | null>(null)
  const [shortcutFeedback, setShortcutFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (isSettingsModalOpen && settingsInitialTab) {
      setActiveTab(settingsInitialTab)
    }
  }, [isSettingsModalOpen, settingsInitialTab])

  useEffect(() => {
    if (!isSettingsModalOpen) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return

    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        const filtered: EnumeratedDevice[] = list
          .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
          .map((d, idx) => ({
            deviceId: d.deviceId || `dev-${idx}`,
            label:
              d.label ||
              (d.kind === 'audioinput' ? `Audio Input ${idx + 1}` : `Speaker ${idx + 1}`),
            kind: d.kind as 'audioinput' | 'audiooutput'
          }))
        setDevices(filtered)

        // Auto-sanitize stale localStorage loopback device IDs that are not valid virtual loopbacks
        if (selectedLoopbackDeviceId !== 'system_loopback') {
          const validVirtualLoopbacks = filtered.filter(
            (d) => d.kind === 'audioinput' && VIRTUAL_LOOPBACK_REGEX.test(d.label)
          )
          if (!validVirtualLoopbacks.some((d) => d.deviceId === selectedLoopbackDeviceId)) {
            setSelectedLoopbackDeviceId('system_loopback')
          }
        }
      })
      .catch(() => setDevices([]))
  }, [isSettingsModalOpen, selectedLoopbackDeviceId, setSelectedLoopbackDeviceId])

  useEffect(() => {
    if (!isSettingsModalOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !recordingActionId) {
        closeSettingsModal()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isSettingsModalOpen, recordingActionId, closeSettingsModal])

  useEffect(() => {
    if (!recordingActionId) return

    const handleCaptureShortcut = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

      const parts: string[] = []
      if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')

      const normalizedKey =
        e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
      parts.push(normalizedKey)

      const accelerator = parts.join('+')
      void updateShortcutBinding(recordingActionId, accelerator).then((ok) => {
        if (!ok) {
          setShortcutFeedback(`Shortcut "${accelerator}" is already in use by another app.`)
        } else {
          setShortcutFeedback(`Shortcut updated to ${accelerator}.`)
        }
        setTimeout(() => setShortcutFeedback(null), 3000)
      })
      setRecordingActionId(null)
    }

    window.addEventListener('keydown', handleCaptureShortcut, { capture: true })
    return () => window.removeEventListener('keydown', handleCaptureShortcut, { capture: true })
  }, [recordingActionId, updateShortcutBinding])

  if (!isSettingsModalOpen) return null

  const inputDevices = devices.filter((d) => d.kind === 'audioinput')
  const outputDevices = devices.filter((d) => d.kind === 'audiooutput')

  const tabs: Array<{ id: SettingsTabId; label: string; icon: React.ReactNode }> = [
    { id: 'audio', label: 'Audio', icon: <Volume2 className="h-4 w-4" strokeWidth={1.75} /> },
    {
      id: 'interpretation',
      label: 'Interpretation',
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.75} />
    },
    { id: 'reading', label: 'Reading & HUD', icon: <Type className="h-4 w-4" strokeWidth={1.75} /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard className="h-4 w-4" strokeWidth={1.75} /> },
    { id: 'privacy', label: 'Privacy', icon: <ShieldCheck className="h-4 w-4" strokeWidth={1.75} /> }
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="animate-glass-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4 select-none"
    >
      <div className="glass-sheet animate-glass-modal flex h-[600px] max-h-[88vh] w-full max-w-[840px] flex-col overflow-hidden rounded-[26px]">
        {/* Clean macOS Settings Title Bar */}
        <div className="flex h-13 shrink-0 items-center justify-between border-b border-white/[0.07] px-5">
          <h2
            id="settings-modal-title"
            className="text-sm font-semibold tracking-tight text-white"
          >
            Settings
          </h2>
          <button
            type="button"
            onClick={closeSettingsModal}
            aria-label="Close Settings"
            className="glass-control-hover flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-white/60 hover:text-white"
            title="Close (Escape)"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* macOS System Settings Split Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Navigation Rail */}
          <nav
            role="tablist"
            aria-orientation="vertical"
            className="w-48 shrink-0 border-r border-white/[0.07] bg-white/[0.02] p-3 space-y-1 text-xs"
          >
            {tabs.map((tab, tabIdx) => {
              const isSelected = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={isSelected}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault()
                      const nextIdx =
                        e.key === 'ArrowDown'
                          ? (tabIdx + 1) % tabs.length
                          : (tabIdx - 1 + tabs.length) % tabs.length
                      setActiveTab(tabs[nextIdx].id)
                      const tabButtons = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                      tabButtons?.[nextIdx]?.focus()
                    }
                  }}
                  className={`glass-control-hover flex w-full items-center space-x-2.5 rounded-xl px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 ${
                    isSelected
                      ? 'bg-accent-steel/22 text-white font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                      : 'text-white/65 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <span className={isSelected ? 'text-accent-steel' : 'text-white/45'}>
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Right Grouped Settings Viewport */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
            {/* ============================================================
             * TAB 1: AUDIO (Plain-English Everyday Audio Controls)
             * ============================================================ */}
            {activeTab === 'audio' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-white">Audio</h3>
                  <p className="mt-0.5 text-white/50">
                    DualAI translates system call audio only — your microphone is never sent to AI.
                  </p>
                </div>

                {/* Devices Grouped Card */}
                <div className="glass-grouped-card rounded-2xl divide-y divide-white/[0.06]">
                  <label className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="font-medium text-white/85 shrink-0">Call Audio Source</span>
                    <select
                      value={selectedLoopbackDeviceId}
                      onChange={(e) => setSelectedLoopbackDeviceId(e.target.value)}
                      className="max-w-[260px] rounded-xl border border-white/[0.1] bg-white/[0.06] px-3 py-1.5 text-xs text-white outline-none focus:border-accent-steel"
                    >
                      <option value="system_loopback">Automatic System Audio (Recommended)</option>
                      {inputDevices
                        .filter((d) => VIRTUAL_LOOPBACK_REGEX.test(d.label))
                        .map((d) => (
                          <option key={`lb-${d.deviceId}`} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="font-medium text-white/85 shrink-0">Speakers / Headphones</span>
                    <select
                      value={selectedOutputDeviceId}
                      onChange={(e) => setSelectedOutputDeviceId(e.target.value)}
                      className="max-w-[260px] rounded-xl border border-white/[0.1] bg-white/[0.06] px-3 py-1.5 text-xs text-white outline-none focus:border-accent-steel"
                    >
                      <option value="default">System Default Output</option>
                      {outputDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Hold Mute Info */}
                <div className="glass-grouped-card rounded-2xl">
                  <div className="px-4 py-3 text-[11px] leading-relaxed text-white/60">
                    Press <span className="font-mono text-white/85">SPACE</span> or click the
                    microphone button in the bottom bar to mute your OS microphone across Zoom, Teams,
                    and all calls when on hold — without interrupting live call translation.
                  </div>
                </div>

                {/* Volume & Sound Test */}
                <div className="glass-grouped-card rounded-2xl p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-white">Call Audio Volume & Check</span>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => void playHardwareCalibrationTone(gainChannelB)}
                        aria-label="Play 440Hz Monitor Tone"
                        className="glass-control-hover flex items-center space-x-1.5 rounded-full border border-white/[0.12] bg-white/[0.08] px-3 py-1 text-[11px] font-medium text-white"
                      >
                        <Volume2 className="h-3.5 w-3.5 text-accent-steel" />
                        <span>Test Sound</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white/70">Call Audio Volume</span>
                      <span className="font-mono tabular-nums text-white">
                        {Math.round(gainChannelB * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      aria-label="Call Audio Volume"
                      min="0.0"
                      max="2.0"
                      step="0.05"
                      value={gainChannelB}
                      onChange={(e) => setGainChannelB(parseFloat(e.target.value))}
                      className="apple-slider w-full"
                    />
                  </div>

                  <div className="space-y-1.5 border-t border-white/[0.06] pt-3">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white/70">Voice Detection Sensitivity</span>
                      <span className="font-mono tabular-nums text-white">
                        {Math.round(vadThreshold * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      aria-label="Voice Detection Sensitivity"
                      min="0.2"
                      max="0.9"
                      step="0.05"
                      value={vadThreshold}
                      onChange={(e) => setVadThreshold(parseFloat(e.target.value))}
                      className="apple-slider w-full"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================
             * TAB: INTERPRETATION & DOMAIN PRESETS
             * ============================================================ */}
            {activeTab === 'interpretation' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-white">
                    Interpretation & Vocabulary
                  </h3>
                  <p className="mt-0.5 text-white/50">
                    Fine-tune conversation direction, speed, and specialized field terminology.
                  </p>
                </div>

                {/* Mode & Speed Grouped Card */}
                <div className="glass-grouped-card rounded-2xl divide-y divide-white/[0.06]">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 py-3.5">
                    <div className="pr-2 min-w-0">
                      <p className="font-semibold text-white text-xs">Interpretation Mode</p>
                      <p className="text-[11px] text-white/45 leading-normal">
                        Choose whether to translate in one direction or alternate back-and-forth
                      </p>
                    </div>
                    <div className="shrink-0">
                      <GlassSegmentedControl<OperatingMode>
                        ariaLabel="Interpretation Mode"
                        value={operatingMode}
                        onChange={setOperatingMode}
                        options={[
                          { id: 'translate', label: 'One-Way', icon: ArrowRight },
                          { id: 'conversation', label: 'Two-Way', icon: ArrowRightLeft }
                        ]}
                      />
                    </div>
                  </div>
                </div>

                {/* Domain & Vocabulary Presets */}
                <div className="space-y-2">
                  <span className="font-semibold text-white">Specialized Field & Vocabulary</span>
                  <p className="text-[11px] text-white/45">
                    Select a specialized vocabulary model to ensure industry terms, acronyms, and critical names are translated with clinical precision.
                  </p>
                  <div className="grid grid-cols-1 gap-2 pt-1">
                    {(Object.keys(DOMAIN_PRESETS) as DomainId[]).map((dId) => {
                      const preset = DOMAIN_PRESETS[dId]
                      const isSelected = domainId === dId
                      return (
                        <button
                          key={dId}
                          type="button"
                          onClick={() => setDomainId(dId)}
                          className={`glass-control-hover flex items-start justify-between rounded-2xl border p-3.5 text-left transition-all ${
                            isSelected
                              ? 'border-accent-steel/60 bg-accent-steel/14 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]'
                              : 'glass-grouped-card text-white/70 hover:bg-white/[0.06] hover:text-white'
                          }`}
                        >
                          <div className="space-y-1 pr-3">
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-xs text-white">
                                {preset.label}
                              </span>
                              <span className="rounded-full border border-white/[0.1] bg-white/[0.06] px-2 py-0.5 text-[9px] font-mono text-white/60 uppercase">
                                {preset.category}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-white/55">
                              {preset.description}
                            </p>
                          </div>
                          {isSelected && (
                            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-steel text-white">
                              <Check className="h-3 w-3" strokeWidth={2.5} />
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================
             * TAB 2: READING & HUD (Pure Reading Comfort Controls)
             * ============================================================ */}
            {activeTab === 'reading' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold tracking-tight text-white">
                      Reading & Teleprompter
                    </h3>
                    <p className="mt-0.5 text-white/50">
                      Customize how transcripts and the floating teleprompter look while you read.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetWorkspaceDisplaySettings}
                    className="glass-control-hover flex items-center space-x-1 rounded-full border border-white/[0.1] bg-white/[0.06] px-3 py-1 text-[11px] text-white/75 hover:text-white"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset</span>
                  </button>
                </div>

                {/* Layout Picker */}
                <div className="space-y-2">
                  <span className="text-[11px] font-medium text-white/55">Reading Layout</span>
                  <div className="grid grid-cols-3 gap-2">
                    {VIEW_MODE_OPTIONS.map((opt) => {
                      const Icon = VIEW_ICONS[opt.id]
                      const active = workspaceDisplaySettings.viewMode === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateWorkspaceDisplaySettings({ viewMode: opt.id })}
                          className={`glass-control-hover flex flex-col items-start rounded-2xl border p-3 text-left ${
                            active
                              ? 'border-accent-steel/55 bg-accent-steel/18 text-white'
                              : 'border-white/[0.07] bg-white/[0.04] text-white/70 hover:text-white'
                          }`}
                        >
                          <Icon
                            className={`h-4 w-4 mb-2 ${active ? 'text-accent-steel' : 'text-white/50'}`}
                            strokeWidth={1.75}
                          />
                          <span className="text-xs font-semibold leading-tight">{opt.shortLabel}</span>
                          <span className="mt-0.5 text-[10px] text-white/45 leading-snug">
                            {opt.description}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Typography Card */}
                <div className="glass-grouped-card rounded-2xl p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    {WORKSPACE_FONT_OPTIONS.map((opt) => {
                      const active = workspaceDisplaySettings.fontFamily === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateWorkspaceDisplaySettings({ fontFamily: opt.id })}
                          className={`glass-control-hover flex items-center justify-between rounded-xl border px-3 py-2 text-left ${
                            active
                              ? 'border-accent-steel/55 bg-accent-steel/18 text-white'
                              : 'border-white/[0.07] bg-white/[0.04] text-white/70 hover:text-white'
                          }`}
                        >
                          <span className="text-xs font-medium" style={{ fontFamily: opt.cssStack }}>
                            {opt.label}
                          </span>
                          <span className="text-[10px] text-white/40" style={{ fontFamily: opt.cssStack }}>
                            Aa
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white/70">Workspace Text Size</span>
                      <span className="font-mono tabular-nums text-white">
                        {workspaceDisplaySettings.fontSizePx}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={MIN_WORKSPACE_FONT_SIZE_PX}
                      max={MAX_WORKSPACE_FONT_SIZE_PX}
                      step={1}
                      value={workspaceDisplaySettings.fontSizePx}
                      onChange={(e) =>
                        updateWorkspaceDisplaySettings({ fontSizePx: parseInt(e.target.value, 10) })
                      }
                      className="apple-slider w-full"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/70">Line Spacing</span>
                    <GlassSegmentedControl<WorkspaceLineSpacing>
                      ariaLabel="Line Spacing"
                      value={workspaceDisplaySettings.lineSpacing}
                      onChange={(val) => updateWorkspaceDisplaySettings({ lineSpacing: val })}
                      options={(Object.keys(LINE_SPACING_METRICS) as WorkspaceLineSpacing[]).map(
                        (key) => ({ id: key, label: LINE_SPACING_METRICS[key].label })
                      )}
                    />
                  </div>
                </div>

                {/* Floating Teleprompter Preferences */}
                <div className="glass-grouped-card rounded-2xl p-4 space-y-3.5">
                  <span className="block text-xs font-semibold text-white">
                    Floating Teleprompter
                  </span>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-white/70">Background Transparency</span>
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
                      <span className="text-white/70">Teleprompter Text Size</span>
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

                  <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
                    <div className="flex items-center space-x-2">
                      <MousePointerClick className="h-3.5 w-3.5 text-white/55" />
                      <div>
                        <p className="text-xs font-medium text-white">Click-Through Mode</p>
                        <p className="text-[10px] text-white/45">
                          Let mouse clicks pass straight to Zoom or Teams behind the teleprompter
                        </p>
                      </div>
                    </div>
                    <AppleSwitch
                      checked={hudSettings.isClickThrough}
                      onChange={(next) => updateHudSettings({ isClickThrough: next })}
                      ariaLabel="Toggle Teleprompter Click-Through"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================
             * TAB 3: KEYBOARD SHORTCUTS
             * ============================================================ */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold tracking-tight text-white">
                      Keyboard Shortcuts
                    </h3>
                    <p className="mt-0.5 text-white/50">
                      Quick keys that work even while you are inside Zoom, Teams, or a browser.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void resetShortcutBindings()}
                    className="glass-control-hover flex items-center space-x-1.5 rounded-full border border-white/[0.1] bg-white/[0.06] px-3 py-1 text-[11px] text-white/75 hover:text-white"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset Defaults</span>
                  </button>
                </div>

                {shortcutFeedback && (
                  <div className="rounded-2xl border border-accent-emerald/40 bg-accent-emerald/12 px-4 py-2.5 text-xs text-accent-emerald">
                    {shortcutFeedback}
                  </div>
                )}

                {/* Toggle Bottom-Left Live Shortcut Hints */}
                <div className="glass-grouped-card flex items-center justify-between rounded-2xl px-4 py-3">
                  <div className="pr-4">
                    <div className="font-medium text-white">Show Live Shortcut Hints</div>
                    <p className="text-[11px] text-white/45">
                      Keep common commands subtly visible at the bottom-left while interpreting
                    </p>
                  </div>
                  <AppleSwitch
                    checked={workspaceDisplaySettings.showShortcutHints}
                    onChange={(next) =>
                      updateWorkspaceDisplaySettings({ showShortcutHints: next })
                    }
                    ariaLabel="Toggle live bottom-left shortcut hints"
                  />
                </div>

                <div className="glass-grouped-card divide-y divide-white/[0.06] rounded-2xl">
                  {shortcutBindings.map((binding) => {
                    const isRecording = recordingActionId === binding.id
                    return (
                      <div
                        key={binding.id}
                        className="flex items-center justify-between px-4 py-3"
                      >
                        <div className="pr-4">
                          <div className="font-medium text-white">{binding.label}</div>
                          <p className="text-[11px] text-white/45">{binding.description}</p>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          <kbd className="rounded-lg border border-white/[0.1] bg-white/[0.06] px-2.5 py-1 font-mono text-[11px] text-white/90">
                            {isRecording ? 'Press keys...' : formatPlatformShortcut(binding.accelerator)}
                          </kbd>
                          <button
                            type="button"
                            onClick={() => setRecordingActionId(isRecording ? null : binding.id)}
                            className={`glass-control-hover rounded-full border px-3 py-1 text-[11px] font-medium ${
                              isRecording
                                ? 'border-accent-amber/55 bg-accent-amber/20 text-accent-amber'
                                : 'border-white/[0.1] bg-white/[0.06] text-white/75 hover:text-white'
                            }`}
                          >
                            {isRecording ? 'Cancel' : 'Change'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ============================================================
             * TAB 4: PRIVACY & ACCOUNT
             * ============================================================ */}
            {activeTab === 'privacy' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-white">
                    Privacy & Account
                  </h3>
                  <p className="mt-0.5 text-white/50">
                    Your conversations stay private and are never saved or used for training.
                  </p>
                </div>

                {/* Clean Account Link Card */}
                <div className="glass-grouped-card flex items-center justify-between rounded-2xl p-4">
                  <div>
                    <p className="text-xs font-semibold text-white">
                      {isGatewayAuthenticated && authSession
                        ? authSession.user.email
                        : 'Not signed in'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/50">
                      {isGatewayAuthenticated
                        ? `${quotaRemainingHours.toFixed(1)} hours remaining in your current cycle`
                        : 'Sign in to start your 1-hour free trial and manage plans'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      closeSettingsModal()
                      openAccountModal()
                    }}
                    className="glass-cta-start flex items-center space-x-1.5 rounded-full px-4 py-1.5 text-xs font-semibold"
                  >
                    <span>{isGatewayAuthenticated ? 'Manage Plan' : 'Sign In'}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Reassuring Privacy Guarantee (Preserves Compliance Clauses Cleanly) */}
                <div className="glass-grouped-card rounded-2xl border-accent-emerald/25 p-4 space-y-3">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="h-4 w-4 text-accent-emerald" strokeWidth={1.85} />
                    <h4 className="text-xs font-semibold text-white">
                      Zero-Data Retention (ZDR) — HIPAA & GDPR Aligned
                    </h4>
                  </div>

                  <p className="leading-relaxed text-white/60">
                    DualAI is designed for private medical, legal, and business conversations. Your
                    audio and transcripts are processed live and never recorded.
                  </p>

                  <ul className="space-y-2 text-[11px] text-white/65">
                    <li>
                      <strong className="text-white/90 font-medium">
                        VOLATILE AUDIO BUFFERS ONLY:
                      </strong>{' '}
                      Audio is processed strictly in temporary memory and never written to disk.
                    </li>
                    <li>
                      <strong className="text-white/90 font-medium">Private sessions:</strong>{' '}
                      Transcripts stay only on your screen during the call and clear instantly when
                      you close the app or clear history.
                    </li>
                    <li>
                      <strong className="text-white/90 font-medium">
                        ZERO MODEL TRAINING GUARANTEE:
                      </strong>{' '}
                      Your speech and translations are never stored or reused to train AI models.
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Clean Footer */}
        <div className="flex h-12 shrink-0 items-center justify-between border-t border-white/[0.07] px-5 text-[11px] text-white/45">
          <button
            type="button"
            onClick={startProductTour}
            className="glass-control-hover flex items-center space-x-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white/75 hover:text-white"
          >
            <Sparkles className="h-3 w-3 text-accent-steel" strokeWidth={1.85} />
            <span>Replay Guided Tour</span>
          </button>
          <button
            type="button"
            onClick={closeSettingsModal}
            className="glass-control-hover rounded-full border border-white/[0.12] bg-white/[0.08] px-4 py-1.5 text-xs font-medium text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
