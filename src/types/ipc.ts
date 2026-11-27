/**
 * DUALAI - Inter-Process Communication (IPC) Protocol Contracts
 * Defines strict type boundaries between Electron Main, Preload, and Renderer.
 */

import { AudioLevelMetric } from './audio'
import { HudBounds, HudSettings, ShortcutBinding } from './settings'

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
  AUDIO_SET_SYSTEM_MIC_MUTE: 'dualai:audio-set-system-mic-mute',
  AUDIO_GET_SYSTEM_MIC_MUTE: 'dualai:audio-get-system-mic-mute',

  // Global Shortcuts & Events (Day 09 & Day 11)
  SHORTCUT_MUTE_TOGGLE: 'dualai:shortcut-mute-toggle',
  SHORTCUT_SWAP_LANGUAGES: 'dualai:shortcut-swap-languages',
  SHORTCUT_TOGGLE_HUD: 'dualai:shortcut-toggle-hud',
  SHORTCUT_TRIGGER_SNIP: 'dualai:shortcut-trigger-snip',
  SHORTCUT_PTT_TOGGLE: 'dualai:shortcut-ptt-toggle',
  SHORTCUT_CLEAR_BUFFER: 'dualai:shortcut-clear-buffer',
  SHORTCUT_UPDATE_BINDINGS: 'dualai:shortcut-update-bindings',

  // Secondary Floating HUD (Day 10)
  HUD_OPEN: 'dualai:hud-open',
  HUD_CLOSE: 'dualai:hud-close',
  HUD_IS_OPEN: 'dualai:hud-is-open',
  HUD_SET_OPACITY: 'dualai:hud-set-opacity',
  HUD_SET_CLICK_THROUGH: 'dualai:hud-set-click-through',
  HUD_UPDATE_CONFIG: 'dualai:hud-update-config',
  HUD_UPDATE_TRANSCRIPT: 'dualai:hud-update-transcript',
  HUD_BOUNDS_CHANGED: 'dualai:hud-bounds-changed',
  HUD_STATUS_CHANGED: 'dualai:hud-status-changed',

  // Zero-Trust OS Keychain Session Vault (Electron safeStorage)
  AUTH_STORE_SESSION: 'dualai:auth-store-session',
  AUTH_LOAD_SESSION: 'dualai:auth-load-session',
  AUTH_CLEAR_SESSION: 'dualai:auth-clear-session',

  // Native Desktop OAuth (Google / Apple via RFC 8252 Loopback)
  AUTH_OAUTH_PREPARE: 'dualai:auth-oauth-prepare',
  AUTH_OAUTH_LAUNCH_AND_WAIT: 'dualai:auth-oauth-launch-and-wait',
  AUTH_OAUTH_CANCEL: 'dualai:auth-oauth-cancel',

  // In-app Paddle checkout window
  CHECKOUT_OPEN: 'dualai:checkout-open',
  CHECKOUT_CLOSED: 'dualai:checkout-closed',

  // Zero-PII local cost & token telemetry (dev diagnostic only)
  TELEMETRY_RECORD_SESSION: 'dualai:telemetry-record-session'
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
  id?: string
  speakerId: string
  speakerLabel: string
  sourceText: string
  translatedText: string
  originalColor?: string
  translationColor?: string
  timestampMs: number
  isInterim: boolean
}

export interface ShortcutRegistrationReport {
  registered: string[]
  failed: string[]
}

export interface OAuthPreparedSession {
  sessionId: string
  redirectUrl: string
}

export interface OAuthCallbackResult {
  ok: boolean
  code?: string
  accessToken?: string
  refreshToken?: string
  error?: string
}

export interface SystemMicMuteResult {
  ok: boolean
  muted: boolean
  error?: string
}

export interface ClientTelemetryPayload {
  sessionId: string
  startedAtIso: string
  endedAtIso: string | null
  status: 'active' | 'closed'
  gatewayUrl: string
  mode: 'translate' | 'conversation'
  pair: string
  domain: string
  wallClockMs: number
  audioSecondsCaptured: number
  audioSecondsSent: number
  audioSecondsSuppressed: number
  audioSecondsEchoBlocked: number
  finalOriginalTokens: number
  finalTranslationTokens: number
  finalizesSent: number
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
  setSystemMicMute: (muted: boolean) => Promise<SystemMicMuteResult>
  getSystemMicMute: () => Promise<{ muted: boolean }>

  // HUD Controls (Day 10)
  openHud: (initialBounds?: HudBounds) => Promise<boolean>
  closeHud: () => Promise<void>
  isHudOpen: () => Promise<boolean>
  setHudOpacity: (opacity: number) => Promise<void>
  setHudClickThrough: (enabled: boolean) => Promise<void>
  sendHudConfig: (config: HudSettings) => void
  sendHudTranscript: (payload: TranscriptPayload) => void

  // Global Shortcuts Registration (Day 11)
  updateGlobalShortcuts: (bindings: ShortcutBinding[]) => Promise<ShortcutRegistrationReport>

  // Zero-Trust OS Keychain Encrypted Session Vault (Electron safeStorage)
  storeEncryptedSession: (serializedSession: string) => Promise<boolean>
  loadEncryptedSession: () => Promise<string | null>
  clearEncryptedSession: () => Promise<boolean>

  // Native Desktop OAuth (Google / Apple via RFC 8252 Loopback)
  prepareOAuthCallback: () => Promise<OAuthPreparedSession>
  launchOAuthAndWait: (sessionId: string, authUrl: string) => Promise<OAuthCallbackResult>
  cancelOAuthCallback: (sessionId: string) => Promise<void>

  // In-app Paddle checkout (modal window, never leaves the app)
  openCheckoutWindow: (url: string) => Promise<boolean>
  onCheckoutClosed: (callback: (completed: boolean) => void) => () => void

  // Zero-PII local cost & token diagnostic telemetry (dev only)
  recordClientTelemetry: (payload: ClientTelemetryPayload) => void

  // Event Listeners (Main -> Renderer)
  onShortcutMute: (callback: () => void) => () => void
  onShortcutSwapLanguages: (callback: () => void) => () => void
  onShortcutToggleHud: (callback: () => void) => () => void
  onShortcutTriggerSnip: (callback: () => void) => () => void
  onShortcutPttToggle: (callback: () => void) => () => void
  onShortcutClearBuffer: (callback: () => void) => () => void
  onSystemAudioMetrics: (callback: (metric: AudioLevelMetric) => void) => () => void
  onHudTranscript: (callback: (payload: TranscriptPayload) => void) => () => void
  onHudConfigUpdate: (callback: (config: HudSettings) => void) => () => void
  onHudBoundsChanged: (callback: (bounds: HudBounds) => void) => () => void
  onHudStatusChanged: (callback: (isOpen: boolean) => void) => () => void
}
