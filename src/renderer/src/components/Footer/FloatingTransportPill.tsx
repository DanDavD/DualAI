import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play,
  Square,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  ChevronDown,
  Check,
  PictureInPicture2,
  Trash2
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { GlassTooltip } from '../UI/GlassTooltip'
import { formatPlatformShortcut } from '../../utils/platform'

interface AudioDeviceOption {
  deviceId: string
  label: string
  isDefaultAlias?: boolean
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function cleanDeviceLabel(rawLabel: string, fallback: string): string {
  const trimmed = rawLabel.trim()
  if (!trimmed) return fallback
  // Strip redundant Chrome/macOS "Default - " or "Communications - " prefix for cleaner display
  return trimmed.replace(/^(Default|Communications)\s*-\s*/i, '').trim() || trimmed
}

/**
 * Floating Bottom-Right Apple Liquid Glass Transport Pill + Whisper-Quiet Bottom-Left Shortcut Hints.
 * Houses Discord-inspired split Mic & Headphones controls with upward Liquid Glass device menus,
 * Mini View floating toggle, and high-contrast Start/Stop CTA.
 */
export const FloatingTransportPill: React.FC = () => {
  const {
    isAudioActive,
    isInitializingAudio,
    isCoughMuted,
    isSystemAudioMuted,
    isHudOpen,
    utterances,
    interimTranscriptA,
    interimTranscriptB,
    clearTranscripts,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    setSelectedInputDeviceId,
    setSelectedOutputDeviceId,
    workspaceDisplaySettings,
    startAudioEngine,
    stopAudioEngine,
    toggleCoughMute,
    toggleSystemAudioMute,
    toggleHud
  } = useSession()

  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [openMenu, setOpenMenu] = useState<'input' | 'output' | null>(null)
  const [inputDevices, setInputDevices] = useState<AudioDeviceOption[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([])
  const [defaultInputName, setDefaultInputName] = useState<string | null>(null)
  const [defaultOutputName, setDefaultOutputName] = useState<string | null>(null)

  const pillContainerRef = useRef<HTMLDivElement>(null)
  const hasToggledMicRef = useRef(false)
  const prevMicMutedRef = useRef(isCoughMuted)
  const hasToggledHeadphonesRef = useRef(false)
  const prevHeadphonesMutedRef = useRef(isSystemAudioMuted)

  useEffect(() => {
    if (prevMicMutedRef.current !== isCoughMuted) {
      hasToggledMicRef.current = true
      prevMicMutedRef.current = isCoughMuted
    }
  }, [isCoughMuted])

  useEffect(() => {
    if (prevHeadphonesMutedRef.current !== isSystemAudioMuted) {
      hasToggledHeadphonesRef.current = true
      prevHeadphonesMutedRef.current = isSystemAudioMuted
    }
  }, [isSystemAudioMuted])

  useEffect(() => {
    if (!isAudioActive) {
      setElapsedSeconds(0)
      return
    }
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [isAudioActive])

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs: AudioDeviceOption[] = []
      const outputs: AudioDeviceOption[] = []
      const seenInputIds = new Set<string>()
      const seenOutputIds = new Set<string>()
      let defIn: string | null = null
      let defOut: string | null = null

      let inIdx = 1
      let outIdx = 1

      for (const dev of all) {
        if (dev.kind === 'audioinput') {
          if (dev.deviceId === 'default') {
            if (dev.label) defIn = cleanDeviceLabel(dev.label, '')
            continue
          }
          if (dev.deviceId === 'communications' || !dev.deviceId || seenInputIds.has(dev.deviceId)) {
            continue
          }
          seenInputIds.add(dev.deviceId)
          inputs.push({
            deviceId: dev.deviceId,
            label: cleanDeviceLabel(dev.label, `Microphone ${inIdx++}`)
          })
        } else if (dev.kind === 'audiooutput') {
          if (dev.deviceId === 'default') {
            if (dev.label) defOut = cleanDeviceLabel(dev.label, '')
            continue
          }
          if (
            dev.deviceId === 'communications' ||
            !dev.deviceId ||
            seenOutputIds.has(dev.deviceId)
          ) {
            continue
          }
          seenOutputIds.add(dev.deviceId)
          outputs.push({
            deviceId: dev.deviceId,
            label: cleanDeviceLabel(dev.label, `Speaker / Headphones ${outIdx++}`)
          })
        }
      }

      setDefaultInputName(defIn)
      setDefaultOutputName(defOut)
      setInputDevices(inputs)
      setOutputDevices(outputs)
    } catch {
      // Ignore enumeration errors in restricted environments
    }
  }, [])

  // Refresh device lists on mount, on hardware plug/unplug, and whenever a menu opens or session starts
  useEffect(() => {
    void refreshDevices()
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return
    const handleDeviceChange = () => {
      void refreshDevices()
    }
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [refreshDevices, isAudioActive])

  useEffect(() => {
    if (!openMenu) return
    void refreshDevices()
    const handleOutside = (e: MouseEvent) => {
      if (pillContainerRef.current && !pillContainerRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [openMenu, refreshDevices])

  const activeInputLabel =
    selectedInputDeviceId === 'default'
      ? defaultInputName
        ? `System Default (${defaultInputName})`
        : 'System Default Microphone'
      : inputDevices.find((d) => d.deviceId === selectedInputDeviceId)?.label || 'Custom Microphone'

  const activeOutputLabel =
    selectedOutputDeviceId === 'default'
      ? defaultOutputName
        ? `System Default (${defaultOutputName})`
        : 'System Default Output'
      : outputDevices.find((d) => d.deviceId === selectedOutputDeviceId)?.label || 'Custom Output'

  const hasClearableContent =
    utterances.length > 0 || Boolean(interimTranscriptA) || Boolean(interimTranscriptB)

  return (
    <>
      {/* Whisper-Quiet Bottom-Left Shortcut Strip (Visible during active interpretation unless disabled in Settings) */}
      {isAudioActive && workspaceDisplaySettings.showShortcutHints && (
        <div
          aria-label="Common keyboard shortcuts"
          className="animate-glass-pop-up pointer-events-none fixed bottom-6 left-5 z-20 hidden md:flex items-center space-x-3 rounded-full glass-capsule-subtle px-3 py-1.5 text-[10px] text-white/45 select-none"
        >
          <span className="flex items-center space-x-1">
            <kbd className="rounded border border-white/[0.1] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-white/65">
              SPACE
            </kbd>
            <span>Mute</span>
          </span>
          <span className="h-2.5 w-px bg-white/[0.08]" />
          <span className="flex items-center space-x-1">
            <kbd className="rounded border border-white/[0.1] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-white/65">
              {formatPlatformShortcut('CommandOrControl+Shift+S')}
            </kbd>
            <span>Swap</span>
          </span>
          <span className="h-2.5 w-px bg-white/[0.08]" />
          <span className="flex items-center space-x-1">
            <kbd className="rounded border border-white/[0.1] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-white/65">
              {formatPlatformShortcut('CommandOrControl+Shift+H')}
            </kbd>
            <span>Mini View</span>
          </span>
        </div>
      )}

      {/* Floating Bottom-Right Liquid Glass Transport Pill */}
      <div
        ref={pillContainerRef}
        role="region"
        aria-label="Session Transport Controls"
        className="fixed bottom-5 right-5 z-30 select-none"
      >
        {/* Upward Liquid Glass Input / Output Device Selector Popover */}
        {openMenu && (
          <div
            role="menu"
            aria-label={openMenu === 'input' ? 'Select Input Device' : 'Select Output Device'}
            className="glass-sheet animate-glass-pop-up absolute bottom-full left-0 mb-2.5 z-50 w-[290px] max-w-[calc(100vw-32px)] rounded-[20px] p-2 text-left text-xs text-text-primary"
          >
            <div className="flex items-center justify-between px-2.5 py-1.5">
              <div className="flex items-center space-x-1.5">
                {openMenu === 'input' ? (
                  <Mic className="h-3.5 w-3.5 text-accent-steel" strokeWidth={1.75} />
                ) : (
                  <Headphones className="h-3.5 w-3.5 text-accent-steel" strokeWidth={1.75} />
                )}
                <span className="text-[11px] font-semibold tracking-tight text-white">
                  {openMenu === 'input' ? 'Input Device' : 'Output Device'}
                </span>
              </div>
              <span className="text-[10px] text-white/40">
                {openMenu === 'input'
                  ? `${inputDevices.length + 1} available`
                  : `${outputDevices.length + 1} available`}
              </span>
            </div>

            <div className="mt-0.5 max-h-60 overflow-y-auto space-y-0.5 pr-0.5">
              {openMenu === 'input' ? (
                <>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedInputDeviceId === 'default'}
                    onClick={() => {
                      setSelectedInputDeviceId('default')
                      setOpenMenu(null)
                    }}
                    className={`glass-control-hover flex w-full items-center justify-between rounded-xl border px-2.5 py-2 text-left transition-colors ${
                      selectedInputDeviceId === 'default'
                        ? 'border-accent-steel/45 bg-accent-steel/20 text-white font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                        : 'border-transparent text-white/75 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate text-[11px] leading-tight">System Default</div>
                      {defaultInputName && (
                        <div className="mt-0.5 truncate text-[10px] font-normal text-white/45">
                          {defaultInputName}
                        </div>
                      )}
                    </div>
                    {selectedInputDeviceId === 'default' && (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-accent-steel"
                        strokeWidth={2.25}
                      />
                    )}
                  </button>

                  {inputDevices.map((dev) => {
                    const isSelected = selectedInputDeviceId === dev.deviceId
                    return (
                      <button
                        key={dev.deviceId}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        onClick={() => {
                          setSelectedInputDeviceId(dev.deviceId)
                          setOpenMenu(null)
                        }}
                        className={`glass-control-hover flex w-full items-center justify-between rounded-xl border px-2.5 py-2 text-left transition-colors ${
                          isSelected
                            ? 'border-accent-steel/45 bg-accent-steel/20 text-white font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                            : 'border-transparent text-white/75 hover:bg-white/[0.08] hover:text-white'
                        }`}
                      >
                        <span className="truncate pr-2 text-[11px] leading-tight">{dev.label}</span>
                        {isSelected && (
                          <Check
                            className="h-3.5 w-3.5 shrink-0 text-accent-steel"
                            strokeWidth={2.25}
                          />
                        )}
                      </button>
                    )
                  })}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedOutputDeviceId === 'default'}
                    onClick={() => {
                      setSelectedOutputDeviceId('default')
                      setOpenMenu(null)
                    }}
                    className={`glass-control-hover flex w-full items-center justify-between rounded-xl border px-2.5 py-2 text-left transition-colors ${
                      selectedOutputDeviceId === 'default'
                        ? 'border-accent-steel/45 bg-accent-steel/20 text-white font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                        : 'border-transparent text-white/75 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate text-[11px] leading-tight">System Default</div>
                      {defaultOutputName && (
                        <div className="mt-0.5 truncate text-[10px] font-normal text-white/45">
                          {defaultOutputName}
                        </div>
                      )}
                    </div>
                    {selectedOutputDeviceId === 'default' && (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-accent-steel"
                        strokeWidth={2.25}
                      />
                    )}
                  </button>

                  {outputDevices.map((dev) => {
                    const isSelected = selectedOutputDeviceId === dev.deviceId
                    return (
                      <button
                        key={dev.deviceId}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        onClick={() => {
                          setSelectedOutputDeviceId(dev.deviceId)
                          setOpenMenu(null)
                        }}
                        className={`glass-control-hover flex w-full items-center justify-between rounded-xl border px-2.5 py-2 text-left transition-colors ${
                          isSelected
                            ? 'border-accent-steel/45 bg-accent-steel/20 text-white font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                            : 'border-transparent text-white/75 hover:bg-white/[0.08] hover:text-white'
                        }`}
                      >
                        <span className="truncate pr-2 text-[11px] leading-tight">{dev.label}</span>
                        {isSelected && (
                          <Check
                            className="h-3.5 w-3.5 shrink-0 text-accent-steel"
                            strokeWidth={2.25}
                          />
                        )}
                      </button>
                    )
                  })}
                </>
              )}
            </div>
          </div>
        )}

        <div className="glass-capsule flex items-center space-x-1.5 rounded-full p-1.5 shadow-[0_14px_36px_-6px_rgba(0,0,0,0.65)]">
          {/* 1. Split Microphone Control (Mute + Input Device Dropdown) */}
          <div
            data-tour-id="mute"
            className="flex h-9 items-center rounded-full border border-white/[0.08] bg-white/[0.045] p-0.5"
          >
            <GlassTooltip
              label={isCoughMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              description={activeInputLabel}
              shortcut="SPACE"
              placement="top"
              align="left"
              disabled={openMenu !== null}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur()
                  toggleCoughMute()
                }}
                aria-pressed={isCoughMuted}
                aria-label={
                  isCoughMuted
                    ? 'Unmute microphone (Spacebar)'
                    : 'Engage instant cough mute (Spacebar)'
                }
                className="glass-control-hover flex h-8 w-8 items-center justify-center rounded-l-full focus:outline-none"
              >
                {isCoughMuted ? (
                  <MicOff
                    key="muted"
                    className="h-4 w-4 text-accent-crimson animate-haptic-vibrate"
                    strokeWidth={2}
                  />
                ) : (
                  <Mic
                    key="unmuted"
                    className={`h-4 w-4 text-white/80 hover:text-white transition-colors ${
                      hasToggledMicRef.current ? 'animate-haptic-vibrate' : ''
                    }`}
                    strokeWidth={1.75}
                  />
                )}
              </button>
            </GlassTooltip>

            <span className="h-4 w-px bg-white/[0.09]" />

            <GlassTooltip
              label="Input Device"
              description={activeInputLabel}
              placement="top"
              align="left"
              disabled={openMenu !== null}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur()
                  setOpenMenu((prev) => (prev === 'input' ? null : 'input'))
                }}
                aria-expanded={openMenu === 'input'}
                aria-haspopup="menu"
                aria-label="Choose input microphone device"
                className={`glass-control-hover flex h-8 w-5 items-center justify-center rounded-r-full focus:outline-none ${
                  openMenu === 'input'
                    ? 'bg-white/[0.15] text-white'
                    : 'text-white/55 hover:text-white'
                }`}
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform duration-200 ${
                    openMenu === 'input' ? 'rotate-180' : ''
                  }`}
                  strokeWidth={2}
                />
              </button>
            </GlassTooltip>
          </div>

          {/* 2. Split Headphones Control (Mute System Audio + Output Device Dropdown) */}
          <div className="flex h-9 items-center rounded-full border border-white/[0.08] bg-white/[0.045] p-0.5">
            <GlassTooltip
              label={isSystemAudioMuted ? 'Unmute Call Audio' : 'Mute Call Audio'}
              description={activeOutputLabel}
              placement="top"
              align="center"
              disabled={openMenu !== null}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur()
                  toggleSystemAudioMute()
                }}
                aria-pressed={isSystemAudioMuted}
                aria-label={
                  isSystemAudioMuted ? 'Unmute incoming call audio' : 'Mute incoming call audio'
                }
                className="glass-control-hover flex h-8 w-8 items-center justify-center rounded-l-full focus:outline-none"
              >
                {isSystemAudioMuted ? (
                  <HeadphoneOff
                    key="deafened"
                    className="h-4 w-4 text-accent-crimson animate-haptic-vibrate"
                    strokeWidth={2}
                  />
                ) : (
                  <Headphones
                    key="listening"
                    className={`h-4 w-4 text-white/80 hover:text-white transition-colors ${
                      hasToggledHeadphonesRef.current ? 'animate-haptic-vibrate' : ''
                    }`}
                    strokeWidth={1.75}
                  />
                )}
              </button>
            </GlassTooltip>

            <span className="h-4 w-px bg-white/[0.09]" />

            <GlassTooltip
              label="Output Device"
              description={activeOutputLabel}
              placement="top"
              align="center"
              disabled={openMenu !== null}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur()
                  setOpenMenu((prev) => (prev === 'output' ? null : 'output'))
                }}
                aria-expanded={openMenu === 'output'}
                aria-haspopup="menu"
                aria-label="Choose output audio device"
                className={`glass-control-hover flex h-8 w-5 items-center justify-center rounded-r-full focus:outline-none ${
                  openMenu === 'output'
                    ? 'bg-white/[0.15] text-white'
                    : 'text-white/55 hover:text-white'
                }`}
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform duration-200 ${
                    openMenu === 'output' ? 'rotate-180' : ''
                  }`}
                  strokeWidth={2}
                />
              </button>
            </GlassTooltip>
          </div>

          {/* 3. Clear Transcripts (Trash) */}
          <div data-tour-id="clear" className="inline-flex">
            <GlassTooltip
              label="Clear Screen"
              description={
                hasClearableContent ? 'Clear all transcripts from view' : 'Transcript feed is empty'
              }
              shortcut="Cmd+Shift+K"
              placement="top"
              align="center"
              disabled={openMenu !== null}
            >
              <button
                type="button"
                disabled={!hasClearableContent}
                onClick={(e) => {
                  e.currentTarget.blur()
                  clearTranscripts()
                }}
                aria-label="Clear transcript history"
                className="glass-control-hover flex h-9 w-9 items-center justify-center rounded-full text-white/65 hover:text-accent-crimson focus:outline-none disabled:opacity-30 disabled:pointer-events-none"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </GlassTooltip>
          </div>

          {/* 4. Mini View — Shrink into Compact Floating Window Above Calls */}
          <div data-tour-id="mini-view" className="inline-flex">
            <GlassTooltip
              label={isHudOpen ? 'Close Mini View' : 'Mini View'}
              description={
                isHudOpen
                  ? 'Hide the compact floating window'
                  : 'Shrink into a compact floating overlay above Zoom, Teams & Meet'
              }
              shortcut="Cmd+Shift+H"
              placement="top"
              align="right"
              disabled={openMenu !== null}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur()
                  void toggleHud()
                }}
                aria-pressed={isHudOpen}
                aria-label={isHudOpen ? 'Close Mini View' : 'Open compact Mini View overlay'}
                className={`glass-control-hover flex h-9 items-center space-x-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap focus:outline-none ${
                  isHudOpen
                    ? 'bg-accent-steel/22 text-accent-steel border border-accent-steel/45'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                <PictureInPicture2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span className="hidden sm:inline">Mini View</span>
              </button>
            </GlassTooltip>
          </div>

          {/* 4. High-Contrast Apple CTA Pill (White Start / Apple Red Stop) */}
          <div data-tour-id="start-stop" className="inline-flex">
            <GlassTooltip
              label={isAudioActive ? 'Stop Translation' : 'Start Translation'}
              description={
                isAudioActive ? 'End the active live session' : 'Begin real-time translation'
              }
              placement="top"
              align="right"
              disabled={openMenu !== null}
            >
              <button
                type="button"
                disabled={isInitializingAudio}
                onClick={(e) => {
                  e.currentTarget.blur()
                  if (isAudioActive) {
                    stopAudioEngine()
                  } else {
                    void startAudioEngine()
                  }
                }}
                aria-pressed={isAudioActive}
                aria-label={isAudioActive ? 'Stop Translation Session' : 'Start Translation Session'}
                className={`flex h-9 items-center justify-center space-x-2 rounded-full px-5 text-xs font-semibold tracking-tight whitespace-nowrap focus:outline-none disabled:opacity-60 ${
                  isAudioActive ? 'glass-cta-stop' : 'glass-cta-start'
                }`}
              >
                {isAudioActive ? (
                  <>
                    <Square className="h-3 w-3 fill-current shrink-0" strokeWidth={1.75} />
                    <span>Stop</span>
                    <span className="font-mono text-[11px] font-medium tabular-nums text-white/90 pl-0.5">
                      {formatElapsed(elapsedSeconds)}
                    </span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current shrink-0" strokeWidth={1.75} />
                    <span>{isInitializingAudio ? 'Starting...' : 'Start'}</span>
                  </>
                )}
              </button>
            </GlassTooltip>
          </div>
        </div>
      </div>
    </>
  )
}
