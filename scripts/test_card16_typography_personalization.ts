/**
 * DUALAI - CARD-16 Verification Suite: Live Text Presentation, Typography & Language Color Personalization
 * Empirically audits all CARD-16 Acceptance Criteria (DoD) + live-test refinements:
 * 1. Smooth interim-to-final transitions without layout jump AND zero sub-word spacing corruption
 * 2. Font family, size (13px-28px), line spacing, and editable per-language conversation colors at zero latency
 * 3. Separate Layout menu (Dual / Target-Only / Stacked), streamlined Text menu, Original/Translation headers,
 *    no SubHeader VU bar, and no custom Header window buttons
 * 4. Typography settings synchronize cleanly with Floating Teleprompter HUD + Governance audit
 * Zero Emojis Policy Enforced.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_HUD_SETTINGS,
  DEFAULT_WORKSPACE_DISPLAY_SETTINGS
} from '../src/types/settings.ts'
import {
  CONVERSATION_COLOR_PRESETS,
  MAX_WORKSPACE_FONT_SIZE_PX,
  MIN_WORKSPACE_FONT_SIZE_PX,
  STORAGE_KEY_WORKSPACE_DISPLAY,
  WORKSPACE_FONT_OPTIONS,
  clampWorkspaceFontSize,
  mergeWorkspaceTypographyIntoHud,
  resolveConversationLanguageColor,
  resolveFontFamilyCss,
  resolveLineSpacingMetrics,
  resolveTurnPaneColors,
  sanitizeWorkspaceDisplaySettings
} from '../src/renderer/src/utils/typographyPreferences.ts'
import { SonioxStreamAssembler } from '../src/renderer/src/audio/stt/sonioxStreamAssembler.ts'

console.log('==================================================================')
console.log('DUALAI CARD-16 LIVE TEXT, COLORS & TYPOGRAPHY AUDIT')
console.log('==================================================================\n')

const headerSrc = fs.readFileSync(
  path.resolve('src/renderer/src/components/Header/Header.tsx'),
  'utf-8'
)
const utteranceSrc = fs.readFileSync(
  path.resolve('src/renderer/src/components/Workspace/UtteranceCard.tsx'),
  'utf-8'
)
const translationSrc = fs.readFileSync(
  path.resolve('src/renderer/src/components/Workspace/TranslationCard.tsx'),
  'utf-8'
)
const workspaceSrc = fs.readFileSync(
  path.resolve('src/renderer/src/components/Workspace/DualPaneWorkspace.tsx'),
  'utf-8'
)
const layoutPopoverSrc = fs.readFileSync(
  path.resolve('src/renderer/src/components/SubHeader/WorkspaceLayoutPopover.tsx'),
  'utf-8'
)
const textPopoverSrc = fs.readFileSync(
  path.resolve('src/renderer/src/components/SubHeader/TextPersonalizationPopover.tsx'),
  'utf-8'
)
const subHeaderSrc = fs.readFileSync(
  path.resolve('src/renderer/src/components/SubHeader/SubHeader.tsx'),
  'utf-8'
)
const hudSrc = fs.readFileSync(
  path.resolve('src/renderer/src/components/HUD/TeleprompterHud.tsx'),
  'utf-8'
)
const sessionSrc = fs.readFileSync(
  path.resolve('src/renderer/src/context/SessionContext.tsx'),
  'utf-8'
)

// TEST 1: Smooth Transitions + Zero Soniox BPE Sub-Word Space Corruption + Fluid Non-Selectable Feed
console.log('[TEST 1] Verifying smooth transitions, non-selectable 60fps rows, and BPE sub-word merging...')
assert.ok(
  utteranceSrc.includes('transition-opacity duration-150') &&
    translationSrc.includes('transition-opacity duration-150'),
  'UtteranceCard and TranslationCard must use GPU-composited opacity transitions with zero layout jump'
)
assert.ok(
  utteranceSrc.includes('select-none') &&
    translationSrc.includes('select-none') &&
    !utteranceSrc.includes('group-hover:h-auto'),
  'Transcript feed prevents accidental text selection and zero hover height shift'
)
assert.ok(
  !utteranceSrc.includes('hasLowConfidenceTokens'),
  'UtteranceCard renders utterance.text cleanly without splitting BPE sub-word tokens'
)

const commits: Array<{ text: string; words: string[] }> = []
const asm = new SonioxStreamAssembler(
  {
    channelId: 'channel_b',
    sourceLang: 'en',
    targetLang: 'es',
    operatingMode: 'conversation',
    domainId: 'medical',
    confidenceThreshold: 0.75
  },
  {
    onUnifiedDraft: () => {},
    onUnifiedCommit: (s) => commits.push({ text: s.utterance.text, words: s.utterance.tokens.map((t) => t.text) }),
    onUnifiedCommitUpdate: () => {}
  }
)
asm.ingestTokens([
  { text: 'No', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.9 },
  { text: ' t', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.6 },
  { text: 'ení', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.9 },
  { text: 'an', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.9 },
  { text: ' g', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.8 },
  { text: 'ente', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.95 },
  { text: ' en', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.98 },
  { text: ' españ', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.7 },
  { text: 'ol.', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.95 },
  { text: '<fin>', is_final: true }
])
asm.reset()
assert.equal(commits.length, 1)
assert.equal(commits[0].text, 'No tenían gente en español.')
assert.deepEqual(commits[0].words, ['No', 'tenían', 'gente', 'en', 'español.'])
console.log('  BPE sub-words merged cleanly into whole words ("No tenían gente en español."): VERIFIED')
console.log('PASS: Criterion 1 satisfied.\n')

// TEST 2: Font Family, Size (13px-28px), Line Spacing & Uniform Per-Language Editable Colors
console.log('[TEST 2] Verifying Typography Controls & Strict Per-Language Color Uniformity...')
assert.equal(MIN_WORKSPACE_FONT_SIZE_PX, 13)
assert.equal(MAX_WORKSPACE_FONT_SIZE_PX, 28)
assert.equal(WORKSPACE_FONT_OPTIONS.length, 4)
assert.ok(CONVERSATION_COLOR_PRESETS.length >= 6)
assert.equal(clampWorkspaceFontSize(8), 13)
assert.equal(clampWorkspaceFontSize(44), 28)

const customSettings = sanitizeWorkspaceDisplaySettings({
  fontFamily: 'inter',
  fontSizePx: 18,
  lineSpacing: 'relaxed',
  languageAColor: '#00e5ff',
  languageBColor: '#00ff88'
})

// 3 Spanish speakers and 1 English speaker MUST map strictly by language, never speaker ID
// AND each language MUST keep its exact palette whether it is Original (Left) OR Translation (Right)!
const spanishColor1 = resolveConversationLanguageColor({
  spokenLang: 'es-MX',
  sourceLang: 'en',
  targetLang: 'es',
  settings: customSettings
})
const spanishColor2 = resolveConversationLanguageColor({
  spokenLang: 'es',
  sourceLang: 'en',
  targetLang: 'es',
  settings: customSettings
})
const englishColor = resolveConversationLanguageColor({
  spokenLang: 'en-US',
  sourceLang: 'en',
  targetLang: 'es',
  settings: customSettings
})
assert.equal(spanishColor1, '#00ff88')
assert.equal(spanishColor2, '#00ff88')
assert.equal(englishColor, '#00e5ff')

// Independent Original (Left) vs Translation (Right) color invariance in BOTH directions:
// Case A: Spanish spoken (Left = ES -> #00ff88) -> English translation (Right = EN -> #00e5ff)
const esToEnColors = resolveTurnPaneColors({
  spokenLang: 'es-MX',
  translatedLang: 'en-US',
  sourceLang: 'en',
  targetLang: 'es',
  operatingMode: 'conversation',
  settings: customSettings
})
assert.equal(esToEnColors.originalColor, '#00ff88', 'Spanish Original (left) must use Spanish palette')
assert.equal(esToEnColors.translationColor, '#00e5ff', 'English Translation (right) must use English palette')

// Case B: English spoken (Left = EN -> #00e5ff) -> Spanish translation (Right = ES -> #00ff88)
const enToEsColors = resolveTurnPaneColors({
  spokenLang: 'en',
  translatedLang: undefined,
  sourceLang: 'en',
  targetLang: 'es',
  operatingMode: 'conversation',
  settings: customSettings
})
assert.equal(enToEsColors.originalColor, '#00e5ff', 'English Original (left) must use English palette')
assert.equal(enToEsColors.translationColor, '#00ff88', 'Spanish Translation (right) must use Spanish palette')

// Case C: Translate mode (EN -> ES): Original = EN (#00e5ff), Translation = ES (#00ff88)
const oneWayColors = resolveTurnPaneColors({
  spokenLang: 'en',
  translatedLang: 'es',
  sourceLang: 'en',
  targetLang: 'es',
  operatingMode: 'translate',
  settings: customSettings
})
assert.equal(oneWayColors.originalColor, '#00e5ff')
assert.equal(oneWayColors.translationColor, '#00ff88')

assert.ok(
  workspaceSrc.includes('resolveTurnPaneColors') &&
    workspaceSrc.includes('item.originalColor') &&
    workspaceSrc.includes('item.translationColor'),
  'DualPaneWorkspace must assign independent per-language colors to Original and Translation panes'
)

const t0 = performance.now()
for (let i = 0; i < 2000; i++) {
  const fam = WORKSPACE_FONT_OPTIONS[i % 4].id
  const css = resolveFontFamilyCss(fam)
  const spacing = resolveLineSpacingMetrics(i % 3 === 0 ? 'compact' : i % 3 === 1 ? 'standard' : 'relaxed')
  assert.ok(css.fontFamily.length > 0 && spacing.lineHeight > 1)
}
const avgComputeMs = (performance.now() - t0) / 2000
assert.ok(avgComputeMs < 0.5, `Style resolver too slow: ${avgComputeMs}ms`)
assert.ok(textPopoverSrc.includes('Conversation Colors') && textPopoverSrc.includes('type="color"'))
console.log(`  4 Fonts | 13-28px | Dual-Language Editable Colors | Avg: ${avgComputeMs.toFixed(5)}ms`)
console.log('PASS: Criterion 2 satisfied.\n')

// TEST 3: Separate Layout & Text Menus, Original/Translation Headers, No VU Bar, No Custom Window Buttons
console.log('[TEST 3] Verifying separated Layout/Text menus, Original/Translation headers, removed VU bar & window controls...')
assert.ok(
  subHeaderSrc.includes('<WorkspaceLayoutPopover />') &&
    subHeaderSrc.includes('<TextPersonalizationPopover />'),
  'Layout and Text menus are cleanly separated in SubHeader.tsx'
)
assert.ok(!subHeaderSrc.includes('HardwareVuMeter'), 'Sound detection VU bar removed from SubHeader.tsx')
assert.ok(!headerSrc.includes('handleMinimize') && !headerSrc.includes('Minimize Window'), 'Custom window buttons removed from Header.tsx')
assert.ok(!textPopoverSrc.includes('Workspace Layout'), 'Workspace Layout is NOT clumped inside Text menu')
for (const removedToggle of [
  'High-Contrast Text',
  'Show Timestamps',
  'Show Speaker Labels',
  'Show Latency Badges',
  'Sync to Teleprompter HUD'
]) {
  assert.ok(!textPopoverSrc.includes(removedToggle), `Clutter toggle "${removedToggle}" removed from Text menu`)
}
assert.ok(
  workspaceSrc.includes('Original') &&
    workspaceSrc.includes('Translation') &&
    workspaceSrc.includes("viewMode === 'dual'") &&
    workspaceSrc.includes("viewMode === 'target_only'") &&
    workspaceSrc.includes("viewMode === 'stacked'"),
  'DualPaneWorkspace displays Original/Translation headers and supports all 3 view modes'
)
assert.ok(
  sessionSrc.includes('STORAGE_KEY_WORKSPACE_DISPLAY') &&
    STORAGE_KEY_WORKSPACE_DISPLAY === 'dualai_workspace_display_settings'
)
const corruptedRestored = sanitizeWorkspaceDisplaySettings({
  fontSizePx: 999,
  languageAColor: 'not-a-color',
  viewMode: 'invalid_mode' as unknown as 'dual'
})
assert.equal(corruptedRestored.fontSizePx, 28)
assert.equal(corruptedRestored.languageAColor, DEFAULT_WORKSPACE_DISPLAY_SETTINGS.languageAColor)
assert.equal(corruptedRestored.viewMode, DEFAULT_WORKSPACE_DISPLAY_SETTINGS.viewMode)
console.log('  Separate Layout & Text menus | Original/Translation headers | No VU bar | No custom window buttons: VERIFIED')
console.log('PASS: Criterion 3 satisfied.\n')

// TEST 4: Automatic HUD Typography Synchronization + Governance Audit
console.log('[TEST 4] Verifying automatic HUD Typography Sync & Governance Audit...')
const syncedHud = mergeWorkspaceTypographyIntoHud(DEFAULT_HUD_SETTINGS, customSettings)
assert.equal(syncedHud.fontFamily, 'inter')
assert.equal(syncedHud.fontSizePx, 24)
assert.equal(syncedHud.lineSpacing, 'relaxed')
assert.equal(syncedHud.opacity, DEFAULT_HUD_SETTINGS.opacity)
assert.ok(hudSrc.includes('resolveFontFamilyCss') && hudSrc.includes('resolveLineSpacingMetrics'))

const auditedFiles = [
  ['src/types/settings.ts', fs.readFileSync(path.resolve('src/types/settings.ts'), 'utf-8')],
  ['src/renderer/src/utils/typographyPreferences.ts', fs.readFileSync(path.resolve('src/renderer/src/utils/typographyPreferences.ts'), 'utf-8')],
  ['src/renderer/src/components/Header/Header.tsx', headerSrc],
  ['src/renderer/src/components/SubHeader/SubHeader.tsx', subHeaderSrc],
  ['src/renderer/src/components/SubHeader/WorkspaceLayoutPopover.tsx', layoutPopoverSrc],
  ['src/renderer/src/components/SubHeader/TextPersonalizationPopover.tsx', textPopoverSrc],
  ['src/renderer/src/components/Workspace/DualPaneWorkspace.tsx', workspaceSrc],
  ['src/renderer/src/components/Workspace/UtteranceCard.tsx', utteranceSrc],
  ['src/renderer/src/components/Workspace/TranslationCard.tsx', translationSrc],
  ['src/renderer/src/components/HUD/TeleprompterHud.tsx', hudSrc]
]
const emojiRegex = /\p{Extended_Pictographic}/u
const gradientRegex = /\bbg-gradient-to-/
const explicitAnyRegex = /(:\s*any\b|\bas\s+any\b|<any>)/

for (const [name, src] of auditedFiles) {
  assert.ok(!emojiRegex.test(src), `UX Violation: Emoji detected in ${name}`)
  assert.ok(!gradientRegex.test(src), `UX Violation: Decorative gradient detected in ${name}`)
  assert.ok(!explicitAnyRegex.test(src), `Code Violation: Explicit any detected in ${name}`)
}
console.log(`  HUD Typography Sync + ${auditedFiles.length} audited files (0 emojis, 0 gradients, 0 any): VERIFIED`)
console.log('PASS: Criterion 4 satisfied.\n')

console.log('==================================================================')
console.log('CARD-16 LIVE TEXT, COLORS & TYPOGRAPHY AUDIT: 4/4 PASSED (100%)')
console.log('==================================================================')
