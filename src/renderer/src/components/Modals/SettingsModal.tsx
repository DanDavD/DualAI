/**
 * DUALAI - Module 4 Configuration Matrix & Custom Glossary Engine (Day 11)
 * 4-Tab enterprise settings modal:
 * - Tab 1: Audio & Hardware (Device selection, gain calibration w/ audible monitor, RNNoise, AEC, VAD)
 * - Tab 2: Translation & Domain (CSV/JSON custom glossary upload, syntax validator, prompt injection)
 * - Tab 3: Global Keyboard Shortcuts (PTT, Mute, Swap, HUD toggle, Buffer clear - active in background)
 * - Tab 4: Account & Compliance (Usage quota gauge, Zero-Data Retention HIPAA/GDPR policy)
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  Sliders,
  BookOpen,
  Keyboard,
  ShieldCheck,
  Volume2,
  Upload,
  CheckCircle2,
  AlertCircle,
  Trash2,
  RotateCcw,
  Plus,
  Mic,
  Key
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { DOMAIN_PRESETS } from '../../../../types/domain'
import { GlossaryValidationResult, ShortcutActionId } from '../../../../types/settings'
import { parseGlossaryFile, SAMPLE_GLOSSARY_CSV } from '../../utils/glossaryParser'

type SettingsTabId = 'audio' | 'domain' | 'shortcuts' | 'compliance'

interface EnumeratedDevice {
  deviceId: string
  label: string
  kind: 'audioinput' | 'audiooutput'
}

export const SettingsModal: React.FC = () => {
  const {
    isSettingsModalOpen,
    closeSettingsModal,
    domainId,
    gainChannelA,
    gainChannelB,
    setGainChannelA,
    setGainChannelB,
    vadThreshold,
    setVadThreshold,
    noiseSuppression,
    setNoiseSuppression,
    echoCancellation,
    setEchoCancellation,
    selectedInputDeviceId,
    selectedLoopbackDeviceId,
    selectedOutputDeviceId,
    loopbackStatus,
    loopbackStatusMessage,
    setSelectedInputDeviceId,
    setSelectedLoopbackDeviceId,
    setSelectedOutputDeviceId,
    playHardwareCalibrationTone,
    isMonitorLoopbackActive,
    setMonitorLoopback,
    isAudioActive,
    customGlossaryEntries,
    addGlossaryEntry,
    importGlossaryEntries,
    removeGlossaryEntry,
    clearCustomGlossary,
    shortcutBindings,
    updateShortcutBinding,
    resetShortcutBindings,
    quotaTotalHours,
    quotaRemainingHours,
    authSession,
    accountQuota,
    isGatewayAuthenticated,
    openAccountModal
  } = useSession()

  const [activeTab, setActiveTab] = useState<SettingsTabId>('audio')
  const [devices, setDevices] = useState<EnumeratedDevice[]>([])
  const [validationResult, setValidationResult] = useState<GlossaryValidationResult | null>(null)
  const [manualSource, setManualSource] = useState('')
  const [manualTarget, setManualTarget] = useState('')
  const [manualNotes, setManualNotes] = useState('')
  const [recordingActionId, setRecordingActionId] = useState<ShortcutActionId | null>(null)
  const [shortcutFeedback, setShortcutFeedback] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeDomain = DOMAIN_PRESETS[domainId] || DOMAIN_PRESETS.general
  const hoursUsed = Math.max(0, quotaTotalHours - quotaRemainingHours)
  const remainingPercent = Math.min(100, Math.max(0, (quotaRemainingHours / quotaTotalHours) * 100))

  // Enumerate hardware audio devices when modal opens
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
              (d.kind === 'audioinput'
                ? `System Microphone #${idx + 1}`
                : `System Output #${idx + 1}`),
            kind: d.kind as 'audioinput' | 'audiooutput'
          }))
        setDevices(filtered)
      })
      .catch(() => {
        setDevices([])
      })
  }, [isSettingsModalOpen])

  // Escape key closes modal (unless currently recording a shortcut)
  useEffect(() => {
    if (!isSettingsModalOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (recordingActionId) {
        e.preventDefault()
        e.stopPropagation()

        if (e.key === 'Escape') {
          setRecordingActionId(null)
          return
        }

        const modifiers: string[] = []
        if (e.metaKey || e.ctrlKey) modifiers.push('CommandOrControl')
        if (e.shiftKey) modifiers.push('Shift')
        if (e.altKey) modifiers.push('Alt')

        const keyUpper = e.key.length === 1 ? e.key.toUpperCase() : e.key
        if (
          ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key) ||
          modifiers.length === 0
        ) {
          return
        }

        const accelerator = `${modifiers.join('+')}+${keyUpper}`
        const targetId = recordingActionId
        setRecordingActionId(null)

        void updateShortcutBinding(targetId, accelerator).then((ok) => {
          setShortcutFeedback(
            ok
              ? `Global shortcut bound to ${accelerator} (active in background).`
              : `Warning: OS declined global registration for ${accelerator}.`
          )
          setTimeout(() => setShortcutFeedback(null), 3500)
        })
        return
      }

      if (e.key === 'Escape') {
        closeSettingsModal()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSettingsModalOpen, recordingActionId, closeSettingsModal, updateShortcutBinding])

  if (!isSettingsModalOpen) return null

  const inputDevices = devices.filter((d) => d.kind === 'audioinput')
  const outputDevices = devices.filter((d) => d.kind === 'audiooutput')

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const result = parseGlossaryFile(file.name, text)
    setValidationResult(result)
    if (result.entries.length > 0) {
      importGlossaryEntries(result.entries, false)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleLoadSampleCsv = () => {
    const result = parseGlossaryFile('sample_terminology.csv', SAMPLE_GLOSSARY_CSV)
    setValidationResult(result)
    if (result.entries.length > 0) {
      importGlossaryEntries(result.entries, false)
    }
  }

  const handleManualAddTerm = () => {
    if (!manualSource.trim() || !manualTarget.trim()) return
    addGlossaryEntry(manualSource, manualTarget, manualNotes || undefined)
    setManualSource('')
    setManualTarget('')
    setManualNotes('')
  }

  const tabs: Array<{ id: SettingsTabId; label: string; icon: React.ReactNode }> = [
    { id: 'audio', label: 'Audio & Hardware', icon: <Sliders className="h-3.5 w-3.5" /> },
    { id: 'domain', label: 'Translation & Domain', icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: 'shortcuts', label: 'Global Shortcuts', icon: <Keyboard className="h-3.5 w-3.5" /> },
    { id: 'compliance', label: 'Account & Compliance', icon: <ShieldCheck className="h-3.5 w-3.5" /> }
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none"
    >
      <div className="flex h-[620px] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-surface-border bg-surface-panel shadow-2xl">
        {/* Top Modal Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-surface-border px-5">
          <div className="flex items-center space-x-2.5">
            <Sliders className="h-4 w-4 text-accent-steel" strokeWidth={1.5} />
            <h2
              id="settings-modal-title"
              className="text-sm font-semibold tracking-tight text-text-primary"
            >
              Configuration Matrix & Custom Glossary Engine
            </h2>
            <span className="rounded border border-surface-border bg-surface-base px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
              MODULE 4
            </span>
          </div>
          <button
            type="button"
            onClick={closeSettingsModal}
            aria-label="Close Configuration Matrix"
            className="rounded p-1 text-text-muted hover:bg-surface-active hover:text-text-primary transition"
            title="Close (Escape)"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Body Layout: Left Navigation Rail + Tab Viewport */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Tab Navigation */}
          <nav
            role="tablist"
            aria-orientation="vertical"
            className="w-56 shrink-0 border-r border-surface-border bg-surface-base p-3 space-y-1 font-mono text-xs"
          >
            {tabs.map((tab) => {
              const isSelected = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={isSelected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex w-full items-center space-x-2.5 rounded px-3 py-2 text-left transition ${
                    isSelected
                      ? 'border border-accent-steel/40 bg-accent-steel/15 text-text-primary font-semibold'
                      : 'border border-transparent text-text-secondary hover:bg-surface-panel hover:text-text-primary'
                  }`}
                >
                  <span className={isSelected ? 'text-accent-steel' : 'text-text-muted'}>
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Right Tab Content Viewport */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
            {/* TAB 1: AUDIO & HARDWARE */}
            {activeTab === 'audio' && (
              <div className="space-y-5">
                <div className="border-b border-surface-border pb-2">
                  <h3 className="text-sm font-semibold text-text-primary">
                    Audio Hardware & Signal Calibration
                  </h3>
                  <p className="mt-0.5 text-text-muted">
                    Configure hardware interfaces, studio gain levels with audible monitor feedback,
                    and real-time DSP noise filtering.
                  </p>
                </div>

                {/* Device Selection */}
                <div className="grid grid-cols-3 gap-3">
                  <label className="space-y-1.5">
                    <span className="block font-mono text-[11px] uppercase text-text-secondary">
                      Channel A Input (Microphone)
                    </span>
                    <select
                      value={selectedInputDeviceId}
                      onChange={(e) => setSelectedInputDeviceId(e.target.value)}
                      className="w-full rounded border border-surface-border bg-surface-base px-2.5 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent-steel"
                    >
                      <option value="default">Default System Microphone</option>
                      {inputDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className="block font-mono text-[11px] uppercase text-text-secondary">
                      Channel B (System Loopback)
                    </span>
                    <select
                      value={selectedLoopbackDeviceId}
                      onChange={(e) => setSelectedLoopbackDeviceId(e.target.value)}
                      className="w-full rounded border border-surface-border bg-surface-base px-2.5 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent-amber"
                    >
                      <option value="system_loopback">
                        Native OS System Audio Loopback (Recommended)
                      </option>
                      {inputDevices.map((d) => (
                        <option key={`lb-${d.deviceId}`} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className="block font-mono text-[11px] uppercase text-text-secondary">
                      Monitor Output Device
                    </span>
                    <select
                      value={selectedOutputDeviceId}
                      onChange={(e) => setSelectedOutputDeviceId(e.target.value)}
                      className="w-full rounded border border-surface-border bg-surface-base px-2.5 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent-steel"
                    >
                      <option value="default">Default System Audio Output</option>
                      {outputDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Channel B System Loopback Telemetry Banner */}
                <div className="flex items-center justify-between rounded border border-surface-border bg-surface-base px-3 py-2 font-mono text-[11px]">
                  <span className="text-text-secondary">
                    System Loopback Status:{' '}
                    <strong
                      className={
                        loopbackStatus === 'native_loopback' || loopbackStatus === 'virtual_device'
                          ? 'text-accent-emerald'
                          : loopbackStatus === 'unavailable'
                            ? 'text-accent-crimson'
                            : 'text-text-muted'
                      }
                    >
                      {loopbackStatus.toUpperCase()}
                    </strong>
                  </span>
                  <span className="text-text-muted truncate max-w-[420px]">
                    {loopbackStatusMessage ||
                      'Uses Electron native CoreAudio/WASAPI loopback or a selected virtual driver (BlackHole / VB-Cable).'}
                  </span>
                </div>

                {/* Hardware Gain Calibration Sliders with Audible Monitor Feedback */}
                <div className="rounded-lg border border-surface-border bg-surface-base p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold uppercase text-text-primary">
                      Hardware Gain Calibration & Audible Monitor
                    </span>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => void playHardwareCalibrationTone(gainChannelA)}
                        className="flex items-center space-x-1.5 rounded border border-accent-steel/40 bg-accent-steel/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-accent-steel hover:bg-accent-steel/25 transition"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        <span>Play 440Hz Monitor Tone</span>
                      </button>
                      <button
                        type="button"
                        disabled={!isAudioActive}
                        onClick={() => setMonitorLoopback(!isMonitorLoopbackActive)}
                        className={`flex items-center space-x-1.5 rounded border px-2.5 py-1 font-mono text-[11px] transition disabled:opacity-40 ${
                          isMonitorLoopbackActive
                            ? 'border-accent-emerald bg-accent-emerald/20 text-accent-emerald font-bold'
                            : 'border-surface-border bg-surface-panel text-text-secondary hover:text-text-primary'
                        }`}
                        title={
                          isAudioActive
                            ? 'Route live microphone through speakers for hardware gain check'
                            : 'Start audio capture to enable live mic monitor loopback'
                        }
                      >
                        <Mic className="h-3.5 w-3.5" />
                        <span>{isMonitorLoopbackActive ? 'Mic Monitor ON' : 'Live Mic Monitor'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Channel A Calibration Slider */}
                  <div className="space-y-1.5 font-mono">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-text-secondary">
                        Channel A (Mic) Calibration Gain (plays audible tone on release)
                      </span>
                      <span className="font-bold text-accent-steel">
                        {Math.round(gainChannelA * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="2.0"
                      step="0.05"
                      value={gainChannelA}
                      onChange={(e) => setGainChannelA(parseFloat(e.target.value))}
                      onMouseUp={() => void playHardwareCalibrationTone(gainChannelA)}
                      onKeyUp={() => void playHardwareCalibrationTone(gainChannelA)}
                      className="w-full accent-accent-steel cursor-pointer"
                    />
                  </div>

                  {/* Channel B Calibration Slider */}
                  <div className="space-y-1.5 font-mono">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-text-secondary">
                        Channel B (System Loopback) Input Gain
                      </span>
                      <span className="font-bold text-accent-amber">
                        {Math.round(gainChannelB * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="2.0"
                      step="0.05"
                      value={gainChannelB}
                      onChange={(e) => setGainChannelB(parseFloat(e.target.value))}
                      onMouseUp={() => void playHardwareCalibrationTone(gainChannelB)}
                      className="w-full accent-accent-amber cursor-pointer"
                    />
                  </div>

                  {/* Silero VAD Sensitivity Threshold */}
                  <div className="space-y-1.5 border-t border-surface-border-subtle pt-3 font-mono">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-text-secondary">
                        Silero VAD v5 Speech Onset Threshold
                      </span>
                      <span className="font-bold text-accent-emerald">
                        {Math.round(vadThreshold * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max="0.9"
                      step="0.05"
                      value={vadThreshold}
                      onChange={(e) => setVadThreshold(parseFloat(e.target.value))}
                      className="w-full accent-accent-emerald cursor-pointer"
                    />
                  </div>
                </div>

                {/* Hardware DSP Toggles (RNNoise & AEC) */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-base p-3.5">
                    <div>
                      <p className="font-semibold text-text-primary">RNNoise Suppression</p>
                      <p className="text-[11px] text-text-muted">
                        Neural background fan & office noise gate
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={noiseSuppression}
                      onClick={() => setNoiseSuppression(!noiseSuppression)}
                      className={`rounded border px-3 py-1 font-mono text-[11px] font-bold transition ${
                        noiseSuppression
                          ? 'border-accent-emerald bg-accent-emerald/20 text-accent-emerald'
                          : 'border-surface-border bg-surface-panel text-text-muted'
                      }`}
                    >
                      {noiseSuppression ? 'ENABLED' : 'OFF'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-base p-3.5">
                    <div>
                      <p className="font-semibold text-text-primary">Acoustic Echo Cancellation (AEC)</p>
                      <p className="text-[11px] text-text-muted">
                        Eliminate remote meeting speaker feedback
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={echoCancellation}
                      onClick={() => setEchoCancellation(!echoCancellation)}
                      className={`rounded border px-3 py-1 font-mono text-[11px] font-bold transition ${
                        echoCancellation
                          ? 'border-accent-emerald bg-accent-emerald/20 text-accent-emerald'
                          : 'border-surface-border bg-surface-panel text-text-muted'
                      }`}
                    >
                      {echoCancellation ? 'ENABLED' : 'OFF'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: TRANSLATION & DOMAIN + CUSTOM GLOSSARY ENGINE */}
            {activeTab === 'domain' && (
              <div className="space-y-5">
                <div className="border-b border-surface-border pb-2">
                  <h3 className="text-sm font-semibold text-text-primary">
                    Translation Engine & Custom Glossary Injection
                  </h3>
                  <p className="mt-0.5 text-text-muted">
                    Upload validated CSV or JSON glossaries injected directly into the Gemini 2.0
                    Flash prompt pipeline. Active preset: <strong>{activeDomain.label}</strong>.
                  </p>
                </div>

                {/* Zero-Trust Managed Cloud Gateway Status (Zero Client API Keys) */}
                <div className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-base p-4">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <Key className="h-3.5 w-3.5 text-accent-emerald" />
                      <span className="font-mono text-xs font-semibold text-text-primary">
                        Zero-Trust Managed AI Gateway
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                          isGatewayAuthenticated
                            ? 'bg-accent-emerald/20 text-accent-emerald'
                            : 'bg-surface-panel text-accent-amber'
                        }`}
                      >
                        {isGatewayAuthenticated ? 'AUTHENTICATED (LIVE)' : 'SIGN IN FOR 1H FREE'}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted">
                      {isGatewayAuthenticated
                        ? `Signed in as ${authSession?.user.email}. Plan: ${accountQuota?.planId.toUpperCase() || 'FREE_TIER'}. Zero provider API keys exist on this device.`
                        : 'End users never configure API keys. Sign in to activate your server-protected 1-hour Free Tier.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      closeSettingsModal()
                      openAccountModal()
                    }}
                    className="shrink-0 rounded bg-accent-steel px-3 py-1.5 font-mono text-[11px] font-bold text-white hover:bg-blue-700 transition"
                  >
                    {isGatewayAuthenticated ? 'Manage Plan' : 'Sign In (1h Free)'}
                  </button>
                </div>

                {/* CSV / JSON Upload & Validation Zone */}
                <div className="rounded-lg border border-dashed border-surface-border bg-surface-base p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Upload className="h-4 w-4 text-accent-steel" />
                      <div>
                        <p className="font-semibold text-text-primary">
                          Import Custom Glossary (CSV or JSON)
                        </p>
                        <p className="font-mono text-[10px] text-text-muted">
                          CSV syntax: source_term,target_term,notes (Max 2MB)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.json,text/csv,application/json"
                        onChange={(e) => void handleFileSelected(e)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={handleLoadSampleCsv}
                        className="rounded border border-surface-border bg-surface-panel px-2.5 py-1.5 font-mono text-[11px] text-text-secondary hover:text-text-primary transition"
                      >
                        Load Sample CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded bg-accent-steel px-3 py-1.5 font-mono text-[11px] font-semibold text-white hover:bg-blue-700 transition"
                      >
                        Upload CSV / JSON
                      </button>
                    </div>
                  </div>

                  {/* Validation Result Report */}
                  {validationResult && (
                    <div
                      className={`rounded border p-2.5 font-mono text-[11px] space-y-1 ${
                        validationResult.isValid
                          ? 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald'
                          : 'border-accent-crimson/40 bg-accent-crimson/10 text-accent-crimson'
                      }`}
                    >
                      <div className="flex items-center space-x-1.5 font-bold">
                        {validationResult.isValid ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {validationResult.isValid
                            ? `Validated & Injected ${validationResult.entries.length} terminology pairs into Gemini prompt context.`
                            : `Validation encountered ${validationResult.errors.length} syntax error(s).`}
                        </span>
                      </div>
                      {validationResult.errors.map((err, i) => (
                        <p key={i} className="text-[10px] text-accent-crimson">
                          - {err}
                        </p>
                      ))}
                      {validationResult.warnings.map((warn, i) => (
                        <p key={i} className="text-[10px] text-accent-amber">
                          - {warn}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Manual Quick Entry */}
                <div className="grid grid-cols-12 gap-2">
                  <input
                    type="text"
                    placeholder="Source term (e.g. dyspnea)"
                    value={manualSource}
                    onChange={(e) => setManualSource(e.target.value)}
                    className="col-span-4 rounded border border-surface-border bg-surface-base px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent-steel"
                  />
                  <input
                    type="text"
                    placeholder="Target term (e.g. disnea)"
                    value={manualTarget}
                    onChange={(e) => setManualTarget(e.target.value)}
                    className="col-span-4 rounded border border-surface-border bg-surface-base px-2.5 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent-steel"
                  />
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={manualNotes}
                    onChange={(e) => setManualNotes(e.target.value)}
                    className="col-span-2 rounded border border-surface-border bg-surface-base px-2 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent-steel"
                  />
                  <button
                    type="button"
                    onClick={handleManualAddTerm}
                    className="col-span-2 flex items-center justify-center space-x-1 rounded bg-surface-active border border-surface-border font-mono text-xs font-semibold text-text-primary hover:border-accent-steel transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add</span>
                  </button>
                </div>

                {/* Active Injected Glossary Table */}
                <div className="rounded-lg border border-surface-border bg-surface-base overflow-hidden">
                  <div className="flex items-center justify-between border-b border-surface-border bg-surface-panel px-3 py-2 font-mono text-[11px]">
                    <span className="font-semibold text-text-primary">
                      Active Prompt-Injected Terms ({customGlossaryEntries.length})
                    </span>
                    {customGlossaryEntries.length > 0 && (
                      <button
                        type="button"
                        onClick={clearCustomGlossary}
                        className="text-text-muted hover:text-accent-crimson transition flex items-center space-x-1"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Clear All</span>
                      </button>
                    )}
                  </div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-surface-border-subtle font-mono text-[11px]">
                    {customGlossaryEntries.length === 0 ? (
                      <div className="p-4 text-center text-text-muted">
                        No custom terms loaded. Upload a CSV/JSON file or click "Load Sample CSV" above.
                      </div>
                    ) : (
                      customGlossaryEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between px-3 py-2 hover:bg-surface-panel/60"
                        >
                          <div className="flex items-center space-x-2">
                            <span className="text-text-primary font-semibold">{entry.source}</span>
                            <span className="text-text-muted">-&gt;</span>
                            <span className="text-accent-emerald font-semibold">{entry.target}</span>
                            {entry.notes && (
                              <span className="text-[10px] text-text-muted">({entry.notes})</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeGlossaryEntry(entry.id)}
                            className="text-text-muted hover:text-accent-crimson"
                            title="Remove term"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: GLOBAL KEYBOARD SHORTCUTS */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-surface-border pb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">
                      Global OS Keyboard Shortcuts
                    </h3>
                    <p className="mt-0.5 text-text-muted">
                      Registered at the OS level via Electron globalShortcut — responds reliably even
                      when DualAI is minimized or unfocused behind Zoom/Teams.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void resetShortcutBindings()}
                    className="flex items-center space-x-1.5 rounded border border-surface-border bg-surface-base px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:text-text-primary transition"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset Defaults</span>
                  </button>
                </div>

                {shortcutFeedback && (
                  <div className="rounded border border-accent-emerald/40 bg-accent-emerald/10 px-3 py-2 font-mono text-[11px] text-accent-emerald">
                    {shortcutFeedback}
                  </div>
                )}

                <div className="divide-y divide-surface-border rounded-lg border border-surface-border bg-surface-base">
                  {shortcutBindings.map((binding) => {
                    const isRecording = recordingActionId === binding.id
                    return (
                      <div
                        key={binding.id}
                        className="flex items-center justify-between px-4 py-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-text-primary">{binding.label}</span>
                            <span className="rounded border border-accent-emerald/30 bg-accent-emerald/10 px-1.5 py-0.5 font-mono text-[9px] text-accent-emerald">
                              BACKGROUND ACTIVE
                            </span>
                          </div>
                          <p className="text-[11px] text-text-muted">{binding.description}</p>
                        </div>

                        <div className="flex items-center space-x-2">
                          <kbd className="rounded border border-surface-border bg-surface-panel px-2.5 py-1 font-mono text-[11px] text-text-primary">
                            {isRecording ? 'PRESS KEYS...' : binding.accelerator}
                          </kbd>
                          <button
                            type="button"
                            onClick={() =>
                              setRecordingActionId(isRecording ? null : binding.id)
                            }
                            className={`rounded border px-2.5 py-1 font-mono text-[11px] transition ${
                              isRecording
                                ? 'border-accent-amber bg-accent-amber/20 text-accent-amber font-bold'
                                : 'border-surface-border bg-surface-panel text-text-secondary hover:text-text-primary'
                            }`}
                          >
                            {isRecording ? 'Cancel' : 'Rebind'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* TAB 4: ACCOUNT & COMPLIANCE (ZERO-DATA RETENTION) */}
            {activeTab === 'compliance' && (
              <div className="space-y-5">
                <div className="border-b border-surface-border pb-2">
                  <h3 className="text-sm font-semibold text-text-primary">
                    Account Usage & Enterprise Compliance
                  </h3>
                  <p className="mt-0.5 text-text-muted">
                    Subscription capacity tracking and binding Zero-Data Retention (ZDR) privacy
                    guarantees for clinical and legal interpreters.
                  </p>
                </div>

                {/* Usage Gauge Card */}
                <div className="rounded-lg border border-surface-border bg-surface-base p-4 space-y-3 font-mono">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary">
                      DUALAI PRO INTERPRETER QUOTA
                    </span>
                    <span className="rounded border border-accent-emerald/40 bg-accent-emerald/10 px-2 py-0.5 text-[10px] font-bold text-accent-emerald">
                      ACTIVE LICENSE
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded border border-surface-border-subtle bg-surface-panel p-2.5">
                      <div className="text-[10px] text-text-muted">REMAINING</div>
                      <div className="mt-1 text-base font-bold text-accent-emerald">
                        {quotaRemainingHours.toFixed(1)}h
                      </div>
                    </div>
                    <div className="rounded border border-surface-border-subtle bg-surface-panel p-2.5">
                      <div className="text-[10px] text-text-muted">CONSUMED</div>
                      <div className="mt-1 text-base font-bold text-text-primary">
                        {hoursUsed.toFixed(1)}h
                      </div>
                    </div>
                    <div className="rounded border border-surface-border-subtle bg-surface-panel p-2.5">
                      <div className="text-[10px] text-text-muted">MONTHLY CAP</div>
                      <div className="mt-1 text-base font-bold text-text-secondary">
                        {quotaTotalHours}h
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-text-muted">
                      <span>Quota Balance</span>
                      <span>{remainingPercent.toFixed(1)}% Available</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-surface-panel border border-surface-border">
                      <div
                        className="h-full bg-accent-steel transition-all"
                        style={{ width: `${remainingPercent}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Zero-Data Retention Compliance Statement */}
                <div className="rounded-lg border border-accent-emerald/30 bg-surface-base p-4 space-y-3">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="h-4 w-4 text-accent-emerald" strokeWidth={1.75} />
                    <h4 className="font-mono text-xs font-bold uppercase tracking-wide text-accent-emerald">
                      Zero-Data Retention (ZDR) & Confidentiality Policy (HIPAA / GDPR Aligned)
                    </h4>
                  </div>

                  <p className="leading-relaxed text-text-secondary">
                    DualAI enforces a strict Zero-Data Retention architecture designed for medical
                    interpretation (HIPAA PHI protection), courtroom proceedings (attorney-client
                    privilege), and enterprise regulatory compliance (GDPR Article 25 Privacy by Design):
                  </p>

                  <ul className="space-y-1.5 font-mono text-[11px] text-text-secondary">
                    <li>
                      1. VOLATILE AUDIO BUFFERS ONLY: Raw 16kHz PCM audio streams and Silero VAD v5
                      tensors exist strictly in volatile RAM and are overwritten continuously inside
                      circular ring buffers. Zero audio files are ever written to local disk.
                    </li>
                    <li>
                      2. EPHEMERAL SESSION MEMORY: Source utterances and translations remain solely
                      in local application memory for the active session and are immediately purged
                      on session termination or Buffer Clear (Cmd/Ctrl+Shift+K).
                    </li>
                    <li>
                      3. ZERO MODEL TRAINING GUARANTEE: External inference endpoints (Deepgram
                      Nova-2 and Google Gemini 2.0 Flash Enterprise API) are invoked strictly under
                      zero-retention, zero-training API agreements; no customer speech or clinical
                      transcripts are stored or reused for model training.
                    </li>
                    <li>
                      4. LOCAL-ONLY CREDENTIALS & GLOSSARIES: Custom glossaries, HUD coordinates,
                      and optional API keys persist exclusively on the local workstation.
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Strip */}
        <div className="flex h-11 shrink-0 items-center justify-between border-t border-surface-border bg-surface-base px-5 font-mono text-[11px] text-text-muted">
          <span>All configuration changes apply immediately and persist locally.</span>
          <button
            type="button"
            onClick={closeSettingsModal}
            className="rounded border border-surface-border bg-surface-panel px-4 py-1 text-xs font-semibold text-text-primary hover:bg-surface-active transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
