import React, { useEffect, useRef, useState } from 'react'
import { Play, Square, Mic, MicOff, PictureInPicture2 } from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { GlassTooltip } from '../UI/GlassTooltip'
import { formatPlatformShortcut } from '../../utils/platform'

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

/**
 * Floating Bottom-Right Apple Liquid Glass Transport Pill + Whisper-Quiet Bottom-Left Shortcut Hints.
 * Houses tactile Cough Mute (vibrates & tints icon crimson with zero bulky pill),
 * Mini View floating toggle, and high-contrast Start/Stop CTA.
 */
export const FloatingTransportPill: React.FC = () => {
  const {
    isAudioActive,
    isInitializingAudio,
    isCoughMuted,
    isHudOpen,
    workspaceDisplaySettings,
    startAudioEngine,
    stopAudioEngine,
    toggleCoughMute,
    toggleHud
  } = useSession()

  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const hasToggledRef = useRef(false)
  const prevMutedRef = useRef(isCoughMuted)

  useEffect(() => {
    if (prevMutedRef.current !== isCoughMuted) {
      hasToggledRef.current = true
      prevMutedRef.current = isCoughMuted
    }
  }, [isCoughMuted])

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
        role="region"
        aria-label="Session Transport Controls"
        className="fixed bottom-5 right-5 z-30 select-none"
      >
        <div className="glass-capsule flex items-center space-x-1 rounded-full p-1.5 shadow-[0_14px_36px_-6px_rgba(0,0,0,0.65)]">
          {/* Instant Zero-Gain Cough Mute (Subtle haptic vibration + crimson icon only, no big red pill) */}
          <div data-tour-id="mute" className="inline-flex">
            <GlassTooltip
              label={isCoughMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              description="Instant silence while coughing or talking off-call"
              shortcut="SPACE"
              placement="top"
              align="right"
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
                className="glass-control-hover flex h-9 w-9 items-center justify-center rounded-full focus:outline-none"
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
                      hasToggledRef.current ? 'animate-haptic-vibrate' : ''
                    }`}
                    strokeWidth={1.75}
                  />
                )}
              </button>
            </GlassTooltip>
          </div>

          {/* Mini View — Shrink into Compact Floating Window Above Calls */}
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

          {/* High-Contrast Apple CTA Pill (White Start / Apple Red Stop) */}
          <div data-tour-id="start-stop" className="inline-flex">
            <GlassTooltip
              label={isAudioActive ? 'Stop Translation' : 'Start Translation'}
              description={
                isAudioActive ? 'End the active live session' : 'Begin real-time translation'
              }
              placement="top"
              align="right"
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
