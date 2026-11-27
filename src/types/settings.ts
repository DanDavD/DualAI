/**
 * DUALAI - System State Machine, HUD, Glossary & Settings Type Definitions
 * Strict zero-any contracts covering Days 09, 10, and 11.
 */

export type SystemPipelineState =
  | 'idle'
  | 'initializing'
  | 'listening'
  | 'transcribing'
  | 'translating'
  | 'muted'
  | 'reconnecting'
  | 'error'

export type WorkspaceFontFamily = 'inter' | 'geist_mono' | 'system_sans' | 'high_legibility'

export type WorkspaceLineSpacing = 'compact' | 'standard' | 'relaxed'

export type WorkspaceViewMode = 'dual' | 'target_only' | 'stacked'

export interface WorkspaceDisplaySettings {
  fontFamily: WorkspaceFontFamily
  fontSizePx: number // 13 to 28
  lineSpacing: WorkspaceLineSpacing
  highContrast: boolean
  viewMode: WorkspaceViewMode
  languageAColor: string // Hex color for primary language (sourceLang) regardless of speaker count
  languageBColor: string // Hex color for secondary language (targetLang) regardless of speaker count
  showTimestamps: boolean
  showSpeakerLabels: boolean
  showLatencyBadges: boolean
  syncTypographyToHud: boolean
  showShortcutHints: boolean
}

export const DEFAULT_WORKSPACE_DISPLAY_SETTINGS: WorkspaceDisplaySettings = {
  fontFamily: 'inter',
  fontSizePx: 15,
  lineSpacing: 'standard',
  highContrast: false,
  viewMode: 'dual',
  languageAColor: '#ffffff',
  languageBColor: '#ffaa00',
  showTimestamps: false,
  showSpeakerLabels: false,
  showLatencyBadges: false,
  syncTypographyToHud: true,
  showShortcutHints: true
}

export interface HudBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface HudSettings {
  opacity: number // 0.0 to 1.0 (0% to 100% solid zinc)
  fontSizePx: number // 14 to 48
  lineLimit: 2 | 4 | 6
  isClickThrough: boolean
  bounds: HudBounds
  fontFamily?: WorkspaceFontFamily
  lineSpacing?: WorkspaceLineSpacing
  highContrast?: boolean
  showSpeakerLabels?: boolean
  showTimestamps?: boolean
  textColor?: string
}

export interface GlossaryEntry {
  id: string
  source: string
  target: string
  notes?: string
  domain?: string
}

export interface GlossaryValidationResult {
  isValid: boolean
  entries: GlossaryEntry[]
  errors: string[]
  warnings: string[]
  totalRowsParsed: number
  duplicateCount: number
}

export type ShortcutActionId =
  | 'ptt'
  | 'mute'
  | 'swap'
  | 'hudToggle'
  | 'clearBuffer'

export interface ShortcutBinding {
  id: ShortcutActionId
  label: string
  description: string
  accelerator: string
  isGlobal: boolean
}

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBinding[] = [
  {
    id: 'ptt',
    label: 'Start / Stop Session',
    description: 'Toggle live call audio translation while running in background',
    accelerator: 'CommandOrControl+Shift+P',
    isGlobal: true
  },
  {
    id: 'mute',
    label: 'System Call Mic Mute',
    description: 'Mute or unmute your OS microphone across Zoom, Teams, and calls during hold',
    accelerator: 'CommandOrControl+Shift+M',
    isGlobal: true
  },
  {
    id: 'swap',
    label: 'Swap Languages',
    description: 'Symmetrically swap active Source and Target language channels',
    accelerator: 'CommandOrControl+Shift+S',
    isGlobal: true
  },
  {
    id: 'hudToggle',
    label: 'Toggle Teleprompter HUD',
    description: 'Show or hide floating transparent overlay above video calls',
    accelerator: 'CommandOrControl+Shift+H',
    isGlobal: true
  },
  {
    id: 'clearBuffer',
    label: 'Clear Session Buffer',
    description: 'Flush active transcript and translation feed memory immediately',
    accelerator: 'CommandOrControl+Shift+K',
    isGlobal: true
  }
]

export const DEFAULT_HUD_SETTINGS: HudSettings = {
  opacity: 0.85,
  fontSizePx: 22,
  lineLimit: 4,
  isClickThrough: false,
  bounds: {
    x: 160,
    y: 80,
    width: 760,
    height: 220
  },
  fontFamily: 'geist_mono',
  lineSpacing: 'standard',
  highContrast: false,
  showSpeakerLabels: true,
  showTimestamps: false
}
