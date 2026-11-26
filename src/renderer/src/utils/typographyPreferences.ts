/**
 * DUALAI - Zero-Latency Typography & Reading Personalization Engine (CARD-16)
 * Pure deterministic CSS style resolvers, strict clamping, localStorage sanitization,
 * and Floating Teleprompter HUD synchronization helpers.
 */

import {
  DEFAULT_WORKSPACE_DISPLAY_SETTINGS,
  HudSettings,
  WorkspaceDisplaySettings,
  WorkspaceFontFamily,
  WorkspaceLineSpacing,
  WorkspaceViewMode
} from '../../../types/settings'

export const STORAGE_KEY_WORKSPACE_DISPLAY = 'dualai_workspace_display_settings'
export const MIN_WORKSPACE_FONT_SIZE_PX = 13
export const MAX_WORKSPACE_FONT_SIZE_PX = 28

export interface FontFamilyOption {
  id: WorkspaceFontFamily
  label: string
  cssStack: string
  letterSpacing: string
}

export const WORKSPACE_FONT_OPTIONS: FontFamilyOption[] = [
  {
    id: 'system_sans',
    label: 'SF Pro',
    cssStack: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
    letterSpacing: '-0.005em'
  },
  {
    id: 'inter',
    label: 'Avenir',
    cssStack: '"Avenir Next", "Avenir", "Century Gothic", "Trebuchet MS", sans-serif',
    letterSpacing: '0.005em'
  },
  {
    id: 'geist_mono',
    label: 'SF Mono',
    cssStack: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace',
    letterSpacing: '-0.015em'
  },
  {
    id: 'high_legibility',
    label: 'Editorial Serif',
    cssStack: 'ui-serif, "New York", Georgia, "Palatino Linotype", serif',
    letterSpacing: '0.008em'
  }
]

export const LINE_SPACING_METRICS: Record<
  WorkspaceLineSpacing,
  { label: string; lineHeight: number; rowPaddingClass: string; hudLineHeight: number }
> = {
  compact: {
    label: 'Compact',
    lineHeight: 1.38,
    rowPaddingClass: 'py-2',
    hudLineHeight: 1.24
  },
  standard: {
    label: 'Standard',
    lineHeight: 1.6,
    rowPaddingClass: 'py-3',
    hudLineHeight: 1.38
  },
  relaxed: {
    label: 'Relaxed',
    lineHeight: 1.85,
    rowPaddingClass: 'py-4',
    hudLineHeight: 1.56
  }
}

export const VIEW_MODE_OPTIONS: Array<{
  id: WorkspaceViewMode
  label: string
  shortLabel: string
  description: string
}> = [
  {
    id: 'dual',
    label: 'Dual-Pane 50/50',
    shortLabel: 'Dual',
    description: 'Source speech on the left, live translation on the right'
  },
  {
    id: 'target_only',
    label: 'Translation Focus',
    shortLabel: 'Target',
    description: 'Full-width target translation feed with maximum reading room'
  },
  {
    id: 'stacked',
    label: 'Compact Stacked',
    shortLabel: 'Stacked',
    description: 'Source line stacked cleanly above target translation in one column'
  }
]

export const CONVERSATION_COLOR_PRESETS: Array<{ label: string; hex: string }> = [
  { label: 'Pure White', hex: '#ffffff' },
  { label: 'Electric Amber', hex: '#ffaa00' },
  { label: 'Electric Cyan', hex: '#00e5ff' },
  { label: 'Neon Green', hex: '#00ff88' },
  { label: 'Neon Lime', hex: '#ccff00' },
  { label: 'Hot Pink', hex: '#ff4da6' }
]

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

export function sanitizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string' && HEX_COLOR_REGEX.test(value.trim())) {
    return value.trim().toLowerCase()
  }
  return fallback
}

function normalizeIsoBase(lang?: string): string {
  if (!lang) return ''
  return lang.trim().toLowerCase().split(/[-_]/)[0] || ''
}

/**
 * Resolves the exact text color for a single language strictly by base ISO code
 * (never by speaker index or left/right pane position), guaranteeing that a language
 * ALWAYS keeps its assigned color palette whether it appears as Original or Translation.
 */
export function resolveConversationLanguageColor(params: {
  spokenLang?: string
  sourceLang: string
  targetLang: string
  settings: WorkspaceDisplaySettings
}): string {
  const lang = normalizeIsoBase(params.spokenLang || params.sourceLang)
  const target = normalizeIsoBase(params.targetLang)
  const source = normalizeIsoBase(params.sourceLang)

  if (lang && lang === target && target !== source) {
    return params.settings.languageBColor
  }
  return params.settings.languageAColor
}

/**
 * Independently resolves Original (left) and Translation (right) colors from each pane's
 * OWN language so English ALWAYS renders in Language A's color and Spanish ALWAYS renders
 * in Language B's color—whether spoken as source on the left or translated on the right.
 */
export function resolveTurnPaneColors(params: {
  spokenLang?: string
  translatedLang?: string
  sourceLang: string
  targetLang: string
  operatingMode: 'translate' | 'conversation'
  settings: WorkspaceDisplaySettings
}): { originalColor: string; translationColor: string } {
  const baseSource = normalizeIsoBase(params.sourceLang) || 'en'
  const baseTarget = normalizeIsoBase(params.targetLang) || 'es'
  const baseSpoken = normalizeIsoBase(params.spokenLang) || baseSource

  const rawTranslated = normalizeIsoBase(params.translatedLang)
  let effectiveTranslated = rawTranslated

  if (params.operatingMode === 'conversation' && baseSource !== baseTarget) {
    // In two-way mode, translation is always the opposite language of the spoken turn
    if (!effectiveTranslated || effectiveTranslated === baseSpoken) {
      effectiveTranslated = baseSpoken === baseTarget ? baseSource : baseTarget
    }
  } else if (!effectiveTranslated) {
    effectiveTranslated = baseTarget
  }

  return {
    originalColor: resolveConversationLanguageColor({
      spokenLang: baseSpoken,
      sourceLang: baseSource,
      targetLang: baseTarget,
      settings: params.settings
    }),
    translationColor: resolveConversationLanguageColor({
      spokenLang: effectiveTranslated,
      sourceLang: baseSource,
      targetLang: baseTarget,
      settings: params.settings
    })
  }
}

export function clampWorkspaceFontSize(sizePx: number): number {
  if (!Number.isFinite(sizePx)) return DEFAULT_WORKSPACE_DISPLAY_SETTINGS.fontSizePx
  return Math.max(
    MIN_WORKSPACE_FONT_SIZE_PX,
    Math.min(MAX_WORKSPACE_FONT_SIZE_PX, Math.round(sizePx))
  )
}

export function resolveFontFamilyCss(family: WorkspaceFontFamily = 'inter'): {
  fontFamily: string
  letterSpacing: string
} {
  const found = WORKSPACE_FONT_OPTIONS.find((opt) => opt.id === family) || WORKSPACE_FONT_OPTIONS[0]
  return {
    fontFamily: found.cssStack,
    letterSpacing: found.letterSpacing
  }
}

export function resolveLineSpacingMetrics(spacing: WorkspaceLineSpacing = 'standard') {
  return LINE_SPACING_METRICS[spacing] || LINE_SPACING_METRICS.standard
}

export function sanitizeWorkspaceDisplaySettings(
  raw: Partial<WorkspaceDisplaySettings> | null | undefined
): WorkspaceDisplaySettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_WORKSPACE_DISPLAY_SETTINGS }
  }

  const validFonts: WorkspaceFontFamily[] = ['inter', 'geist_mono', 'system_sans', 'high_legibility']
  const validSpacings: WorkspaceLineSpacing[] = ['compact', 'standard', 'relaxed']
  const validViews: WorkspaceViewMode[] = ['dual', 'target_only', 'stacked']

  return {
    fontFamily: validFonts.includes(raw.fontFamily as WorkspaceFontFamily)
      ? (raw.fontFamily as WorkspaceFontFamily)
      : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.fontFamily,
    fontSizePx:
      typeof raw.fontSizePx === 'number'
        ? clampWorkspaceFontSize(raw.fontSizePx)
        : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.fontSizePx,
    lineSpacing: validSpacings.includes(raw.lineSpacing as WorkspaceLineSpacing)
      ? (raw.lineSpacing as WorkspaceLineSpacing)
      : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.lineSpacing,
    highContrast:
      typeof raw.highContrast === 'boolean'
        ? raw.highContrast
        : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.highContrast,
    viewMode: validViews.includes(raw.viewMode as WorkspaceViewMode)
      ? (raw.viewMode as WorkspaceViewMode)
      : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.viewMode,
    languageAColor: sanitizeHexColor(
      raw.languageAColor,
      DEFAULT_WORKSPACE_DISPLAY_SETTINGS.languageAColor
    ),
    languageBColor: sanitizeHexColor(
      raw.languageBColor,
      DEFAULT_WORKSPACE_DISPLAY_SETTINGS.languageBColor
    ),
    showTimestamps:
      typeof raw.showTimestamps === 'boolean'
        ? raw.showTimestamps
        : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.showTimestamps,
    showSpeakerLabels:
      typeof raw.showSpeakerLabels === 'boolean'
        ? raw.showSpeakerLabels
        : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.showSpeakerLabels,
    showLatencyBadges:
      typeof raw.showLatencyBadges === 'boolean'
        ? raw.showLatencyBadges
        : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.showLatencyBadges,
    syncTypographyToHud:
      typeof raw.syncTypographyToHud === 'boolean'
        ? raw.syncTypographyToHud
        : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.syncTypographyToHud,
    showShortcutHints:
      typeof raw.showShortcutHints === 'boolean'
        ? raw.showShortcutHints
        : DEFAULT_WORKSPACE_DISPLAY_SETTINGS.showShortcutHints
  }
}

/**
 * Synchronizes workspace typography preferences into the Floating Teleprompter HUD
 * while preserving the HUD's independent opacity, line limit, click-through, and bounds.
 */
export function mergeWorkspaceTypographyIntoHud(
  currentHud: HudSettings,
  workspace: WorkspaceDisplaySettings
): HudSettings {
  if (!workspace.syncTypographyToHud) {
    return currentHud
  }

  // Scale HUD font size cleanly within its 14px-48px range relative to workspace font size (+6px stage boost)
  const syncedHudSize = Math.max(14, Math.min(48, workspace.fontSizePx + 6))

  return {
    ...currentHud,
    fontFamily: workspace.fontFamily,
    fontSizePx: syncedHudSize,
    lineSpacing: workspace.lineSpacing,
    highContrast: workspace.highContrast,
    showSpeakerLabels: workspace.showSpeakerLabels,
    showTimestamps: workspace.showTimestamps
  }
}
