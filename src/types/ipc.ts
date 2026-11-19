/**
 * DUALAI - Inter-Process Communication (IPC) Protocol Contracts
 * Defines strict type boundaries between Electron Main, Preload, and Renderer.
 */

import { AudioDeviceInfo, AudioLevelMetric, LatencyTelemetry } from './audio'

export const IPC_CHANNELS = {
  // Window Management
  WINDOW_MINIMIZE: 'dualai:window-minimize',
  WINDOW_MAXIMIZE: 'dualai:window-maximize',
  WINDOW_CLOSE: 'dualai:window-close',
  WINDOW_IS_MAXIMIZED: 'dualai:window-is-maximized',

  // Audio Device & Loopback
  AUDIO_GET_SOURCES: 'dualai:audio-get-sources',
  AUDIO_CAPTURE_LOOPBACK: 'dualai:audio-capture-loopback',
  AUDIO_STOP_LOOPBACK: 'dualai:audio-stop-loopback',

  // Global Shortcuts & Events
  SHORTCUT_MUTE_TOGGLE: 'dualai:shortcut-mute-toggle',
  SHORTCUT_SWAP_LANGUAGES: 'dualai:shortcut-swap-languages',
  SHORTCUT_TOGGLE_HUD: 'dualai:shortcut-toggle-hud',
  SHORTCUT_TRIGGER_SNIP: 'dualai:shortcut-trigger-snip',

  // Secondary Floating HUD
  HUD_OPEN: 'dualai:hud-open',
  HUD_CLOSE: 'dualai:hud-close',
  HUD_SET_OPACITY: 'dualai:hud-set-opacity',
  HUD_SET_CLICK_THROUGH: 'dualai:hud-set-click-through',
  HUD_UPDATE_TRANSCRIPT: 'dualai:hud-update-transcript'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]

export interface ScreenSourceInfo {
  id: string
  name: string
  thumbnailDataUrl: string
  displayId: string
}

export interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface HudWindowConfig {
  opacity: number
  fontSizePx: number
  isClickThrough: boolean
  lineLimit: 2 | 4 | 6
}

export interface TranscriptPayload {
  speakerId: string
  speakerLabel: string
  sourceText: string
  translatedText: string
  timestampMs: number
  isInterim: boolean
}

/**
 * Contract exposed to Renderer via ContextBridge
 */
export interface ElectronBridgeApi {
  // Window Controls
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  isWindowMaximized: () => Promise<boolean>

  // Hardware & Loopback Sources
  getDesktopSources: () => Promise<ScreenSourceInfo[]>
  captureScreenRegion: (bounds: CaptureBounds) => Promise<string>

  // HUD Controls
  openHud: () => Promise<void>
  closeHud: () => Promise<void>
  setHudOpacity: (opacity: number) => Promise<void>
  setHudClickThrough: (enabled: boolean) => Promise<void>
  sendHudTranscript: (payload: TranscriptPayload) => void

  // Event Listeners (Main -> Renderer)
  onShortcutMute: (callback: () => void) => () => void
  onShortcutSwapLanguages: (callback: () => void) => () => void
  onShortcutToggleHud: (callback: () => void) => () => void
  onShortcutTriggerSnip: (callback: () => void) => () => void
  onSystemAudioMetrics: (callback: (metric: AudioLevelMetric) => void) => () => void
}
