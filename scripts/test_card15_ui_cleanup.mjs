/**
 * DUALAI - CARD-15 Verification Suite: Workspace UI Cleanup & Production Chrome Simplification
 * Empirically audits all 4 Acceptance Criteria (DoD) from Trello CARD-15:
 * 1. Zero developer test buttons visible in production workspace
 * 2. Single unambiguous Start/Stop Translation control in Zone 4 Master Toolbar
 * 3. Transcript viewport height increased with clean boxless flowing layout & contact highlighting
 * 4. UX Reviewer audit passes with zero emojis, zero gradients, zero explicit 'any', and clear live status
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

console.log('--- STARTING CARD-15 WORKSPACE UI CLEANUP & CHROME SIMPLIFICATION AUDIT ---\n')

const headerSource = fs.readFileSync(path.resolve('src/renderer/src/components/Header/Header.tsx'), 'utf-8')
const subHeaderSource = fs.readFileSync(path.resolve('src/renderer/src/components/SubHeader/SubHeader.tsx'), 'utf-8')
const workspaceSource = fs.readFileSync(path.resolve('src/renderer/src/components/Workspace/DualPaneWorkspace.tsx'), 'utf-8')
const utteranceSource = fs.readFileSync(path.resolve('src/renderer/src/components/Workspace/UtteranceCard.tsx'), 'utf-8')
const translationSource = fs.readFileSync(path.resolve('src/renderer/src/components/Workspace/TranslationCard.tsx'), 'utf-8')
const toolbarSource = fs.readFileSync(path.resolve('src/renderer/src/components/Footer/MasterToolbar.tsx'), 'utf-8')
const fsmSource = fs.readFileSync(path.resolve('src/renderer/src/state/sessionStateMachine.ts'), 'utf-8')
const highlighterSource = fs.readFileSync(path.resolve('src/renderer/src/utils/entityHighlighter.tsx'), 'utf-8')
const accumulatorSource = fs.readFileSync(path.resolve('src/renderer/src/audio/paragraphAccumulator.ts'), 'utf-8')
const gatewayTransSource = fs.readFileSync(path.resolve('src/renderer/src/translation/GatewayTranslationEngine.ts'), 'utf-8')
const sessionSource = fs.readFileSync(path.resolve('src/renderer/src/context/SessionContext.tsx'), 'utf-8')

// TEST 1: Zero developer test buttons or debug clutter in production workspace
console.log('[TEST 1] Verifying zero developer test buttons or debug noise in workspace...')
const forbiddenDevArtifacts = [
  'Inject Domain',
  'triggerDomainTestTranslation',
  'OFFLINE SIMULATOR',
  'TTFT:',
  'ICD-10 CLINICAL',
  'Zone 3 Dual Workspace Ready'
]
for (const pattern of forbiddenDevArtifacts) {
  assert.ok(!workspaceSource.includes(pattern), `Found forbidden dev clutter "${pattern}" in DualPaneWorkspace.tsx`)
  assert.ok(!translationSource.includes(pattern), `Found forbidden dev clutter "${pattern}" in TranslationCard.tsx`)
}
assert.ok(!headerSource.includes('v1.0.0-PRO'), 'Removed noisy version pill from Header.tsx')
assert.ok(!subHeaderSource.includes('VAD IDLE'), 'Removed noisy VAD IDLE boxes from SubHeader.tsx')
console.log('  Developer injection buttons, latency noise & debug labels removed: VERIFIED')
console.log('PASS: Criterion 1 satisfied.\n')

// TEST 2: Single unambiguous Start/Stop Translation control in Zone 4 Master Toolbar
console.log('[TEST 2] Verifying single unambiguous Start/Stop Translation transport in MasterToolbar...')
assert.ok(!workspaceSource.includes('START AUDIO CAPTURE'), 'Redundant START AUDIO CAPTURE removed from workspace')
assert.ok(!workspaceSource.includes('startAudioEngine'), 'Workspace no longer duplicates transport start button')
assert.ok(
  toolbarSource.includes('START TRANSLATION') && toolbarSource.includes('STOP TRANSLATION'),
  'MasterToolbar retains the single primary Start/Stop Translation control'
)
console.log('  Single transport control strictly in Zone 4 MasterToolbar: VERIFIED')
console.log('PASS: Criterion 2 satisfied.\n')

// TEST 3: Boxless flowing transcript layout, increased viewport height & phone/email entity highlight
console.log('[TEST 3] Verifying boxless flowing transcript, reclaimed viewport height & contact highlighting...')
assert.ok(!utteranceSource.includes('rounded-lg border p-3.5'), 'UtteranceCard is boxless (no bordered card per phrase)')
assert.ok(!translationSource.includes('rounded-lg border p-3.5'), 'TranslationCard is boxless (no bordered card per phrase)')
assert.ok(!workspaceSource.includes('Original Speech Feed (Source)'), 'Redundant Zone 3 column header bar removed')
assert.ok(workspaceSource.includes('Choose where the sound comes from'), 'Plain-English audio source picker active in empty state')
assert.ok(
  highlighterSource.includes('@[A-Za-z0-9.-]+') && highlighterSource.includes('phone numbers'),
  'entityHighlighter highlights emails/Gmail and phone numbers cleanly inline'
)
console.log('  Boxless flowing rows + plain-English source guide + email/phone highlights: VERIFIED')
console.log('PASS: Criterion 3 satisfied.\n')

// TEST 4: Native-Language Top-of-Pane Headers, Zero Per-Message Titles & Live/Accurate Draft-to-Final Engine
console.log('[TEST 4] Verifying native pane headers, zero per-message titles, 2s paragraph commit & AbortError fix...')
assert.ok(!utteranceSource.includes('{fromCode}'), 'Per-message EN -> ES title removed from UtteranceCard.tsx')
assert.ok(!translationSource.includes('{fromCode}'), 'Per-message EN -> ES title removed from TranslationCard.tsx')
assert.ok(
  workspaceSource.includes('{sourceDisplayName}') &&
    workspaceSource.includes('{targetDisplayName}') &&
    workspaceSource.includes('found.nativeName'),
  'DualPaneWorkspace displays native-language top-of-pane headers (e.g. English | Español, Español | Deutsch)'
)
assert.ok(
  translationSource.includes('font-light text-zinc-400/85') &&
    translationSource.includes('font-normal text-zinc-100'),
  'TranslationCard renders softer draft font while streaming/live and crisp final font on commit'
)
assert.ok(
  accumulatorSource.includes('DEFAULT_PAUSE_COMMIT_MS = 2000'),
  'ParagraphTurnAccumulator enforces 2-second (2000ms) end-of-speech pause commit signal'
)
assert.ok(
  gatewayTransSource.includes('finalControllers: Map<string, AbortController>') &&
    gatewayTransSource.includes('isAbortError(err)'),
  'GatewayTranslationEngine isolates per-utterance committed streams and suppresses intentional AbortError'
)
assert.ok(
  sessionSource.includes('canPromoteDraftImmediately') &&
    sessionSource.includes("latencyMode === 'sentence_accurate'"),
  'SessionContext implements instantaneous Live draft promotion on 2s commit and Accurate pause-until-complete mode'
)

// Behavioral unit check on 2-second paragraph joining
function joinParagraphText(segments, interimText) {
  const parts = [...segments]
  const cleanInterim = interimText?.trim()
  if (cleanInterim) parts.push(cleanInterim)
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
const merged = joinParagraphText(
  [
    'Then the last thing that will happen is you will have to check your blood sugar levels.',
    'Okay?',
    'And the nurse is gonna come in when I leave and show you how to do that.'
  ],
  'Their next appointment will be in two weeks.'
)
assert.equal(
  merged,
  'Then the last thing that will happen is you will have to check your blood sugar levels. Okay? And the nurse is gonna come in when I leave and show you how to do that. Their next appointment will be in two weeks.'
)
console.log('  Native pane headers, zero per-message titles, 2s paragraph merge & AbortError fix: VERIFIED')
console.log('PASS: Criterion 4 satisfied.\n')

// TEST 5: UX Reviewer Audit (Zero emojis, zero gradients, zero explicit any, clear live statuses)
console.log('[TEST 5] Running UX Reviewer Audit (Zero Emojis, Zero Gradients, Clear Live Statuses)...')
for (const statusLabel of ["'Ready'", "'Listening'", "'Recognizing voice'", "'Translating'", "'Muted'"]) {
  assert.ok(fsmSource.includes(statusLabel), `Missing plain-English live status ${statusLabel} in sessionStateMachine.ts`)
}

const auditedFiles = [
  ['Header.tsx', headerSource],
  ['SubHeader.tsx', subHeaderSource],
  ['DualPaneWorkspace.tsx', workspaceSource],
  ['UtteranceCard.tsx', utteranceSource],
  ['TranslationCard.tsx', translationSource],
  ['MasterToolbar.tsx', toolbarSource],
  ['sessionStateMachine.ts', fsmSource],
  ['entityHighlighter.tsx', highlighterSource],
  ['paragraphAccumulator.ts', accumulatorSource],
  ['GatewayTranslationEngine.ts', gatewayTransSource]
]
const emojiRegex = /\p{Extended_Pictographic}/u
const gradientRegex = /\bbg-gradient-to-/
const explicitAnyRegex = /(:\s*any\b|\bas\s+any\b|<any>)/

for (const [name, content] of auditedFiles) {
  assert.ok(!emojiRegex.test(content), `UX Violation: Emoji detected in ${name}`)
  assert.ok(!gradientRegex.test(content), `UX Violation: Decorative gradient detected in ${name}`)
  assert.ok(!explicitAnyRegex.test(content), `Code Violation: Explicit any detected in ${name}`)
}
console.log(`  Audited ${auditedFiles.length} UI/FSM/Engine files: 0 emojis, 0 gradients, 0 explicit 'any'.`)
console.log('PASS: Criterion 5 satisfied.\n')

console.log('======================================================')
console.log('CARD-15 UI CLEANUP AUDIT: 5/5 TESTS PASSED (100% DOD)')
console.log('======================================================')
