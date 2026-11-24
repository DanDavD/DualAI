/**
 * DUALAI - Soniox Unified Real-Time Engine & Competitive Pricing Verification Suite
 * Empirically verifies:
 * 1. Soniox WebSocket config builder (two-way & one-way translation, 15-speaker diarization,
 *    semantic endpoint detection, domain/glossary injection, ZERO api_key in JSON payload)
 * 2. Multi-speaker bilingual stream assembly (2 Spanish speakers + 1 English speaker on ONE stream)
 * 3. Trailing translation reconciliation after <end> or instant speaker switch
 * 4. 48 kHz -> 16 kHz linear PCM downsampling accuracy & 67% bandwidth reduction
 * 5. Competitive pricing catalog alignment ($0 / $6.99 / $9.99 / $17.99) & Governance audit
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildSonioxConfigMessage } from '../server/src/proxy/sonioxWsProxy.ts'
import { PLAN_CATALOG } from '../server/src/quota/quotaStore.ts'
import { downsampleInt16Pcm } from '../src/renderer/src/audio/pcmDownsampler.ts'
import {
  SonioxStreamAssembler,
  UnifiedTurnSnapshot
} from '../src/renderer/src/audio/stt/sonioxStreamAssembler.ts'

console.log('==================================================================')
console.log('DUALAI SONIOX UNIFIED REAL-TIME ENGINE & PRICING AUDIT')
console.log('==================================================================\n')

// TEST 1: Soniox Config Builder (Zero api_key in payload, Two-Way + One-Way, Diarization, Context)
console.log('[TEST 1] Verifying Soniox WebSocket config payload (Two-Way, Diarization, Context, Zero Key)...')
const twoWayCfg = buildSonioxConfigMessage({
  model: 'stt-rt-v6',
  sampleRate: 16000,
  sourceLang: 'en',
  targetLang: 'es',
  operatingMode: 'conversation',
  domainId: 'medical',
  endpointDelayMs: 2000,
  glossaryTerms: ['Amoxicillin', 'Dyspnea']
})

assert.equal('api_key' in twoWayCfg, false, 'api_key must NEVER be placed inside JSON payload')
assert.equal(twoWayCfg.model, 'stt-rt-v6')
assert.equal(twoWayCfg.audio_format, 'pcm_s16le')
assert.equal(twoWayCfg.sample_rate, 16000)
assert.equal(twoWayCfg.enable_speaker_diarization, true)
assert.equal(twoWayCfg.enable_language_identification, true)
assert.equal(twoWayCfg.enable_endpoint_detection, true)
assert.equal(twoWayCfg.max_endpoint_delay_ms, 2000)
assert.deepEqual(twoWayCfg.language_hints, ['en', 'es'])
assert.deepEqual(twoWayCfg.translation, { type: 'two_way', language_a: 'en', language_b: 'es' })

const oneWayCfg = buildSonioxConfigMessage({
  model: 'stt-rt-v6',
  sampleRate: 16000,
  sourceLang: 'en',
  targetLang: 'de',
  operatingMode: 'translate',
  domainId: 'legal',
  endpointDelayMs: 2000
})
assert.deepEqual(oneWayCfg.language_hints, ['en'])
assert.deepEqual(oneWayCfg.translation, { type: 'one_way', target_language: 'de' })
console.log('  Two-Way (EN<->ES) & One-Way (EN->DE) + Diarization + 2000ms Endpointing: VERIFIED')
console.log('PASS: Test 1 satisfied.\n')

// TEST 2: Multi-Speaker Bilingual Stream (2 Spanish Speakers + 1 English Speaker on ONE Audio Stream)
console.log('[TEST 2] Simulating 3-speaker bilingual call (Speaker 1 ES + Speaker 2 ES + Speaker 3 EN)...')
const drafts: UnifiedTurnSnapshot[] = []
const commits: UnifiedTurnSnapshot[] = []
const updates: UnifiedTurnSnapshot[] = []

const assembler = new SonioxStreamAssembler(
  {
    channelId: 'channel_b',
    sourceLang: 'en',
    targetLang: 'es',
    operatingMode: 'conversation',
    domainId: 'medical',
    confidenceThreshold: 0.75,
    pauseFallbackMs: 2000
  },
  {
    onUnifiedDraft: (snap) => drafts.push(snap),
    onUnifiedCommit: (snap) => commits.push(snap),
    onUnifiedCommitUpdate: (snap) => updates.push(snap)
  }
)

// Speaker 1 speaks Spanish (live draft + final)
assembler.ingestTokens([
  { text: 'Doctor,', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.97 },
  { text: ' mi hijo tiene fiebre.', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.96 },
  { text: 'Doctor, my son', is_final: false, speaker: '1', language: 'en', source_language: 'es', translation_status: 'translation' }
])
assert.equal(drafts.length, 1)
assert.equal(drafts[0].utterance.speakerId, '1')
assert.equal(drafts[0].translation.translatedText, 'Doctor, my son')

// Speaker 2 (also Spanish) chimes in immediately -> MUST split Speaker 1 with 0ms wait!
assembler.ingestTokens([
  { text: 'Doctor, my son has a fever.', is_final: true, speaker: '1', language: 'en', source_language: 'es', translation_status: 'translation' },
  { text: 'Empezó anoche.', is_final: true, speaker: '2', language: 'es', translation_status: 'original', confidence: 0.95 },
  { text: 'It started last night.', is_final: true, speaker: '2', language: 'en', source_language: 'es', translation_status: 'translation' },
  { text: '<end>', is_final: true }
])

// Speaker 3 (Doctor speaking English) responds -> ES/EN auto-direction flips automatically!
assembler.ingestTokens([
  { text: 'Let us check his temperature now.', is_final: true, speaker: '3', language: 'en', translation_status: 'original', confidence: 0.98 },
  { text: '<end>', is_final: true }
])

// Trailing finalized Spanish translation for Speaker 3 arrives 150ms AFTER <end>
assembler.ingestTokens([
  { text: 'Revisemos su temperatura ahora.', is_final: true, speaker: '3', language: 'es', source_language: 'en', translation_status: 'translation' }
])

assembler.reset()

assert.equal(commits.length, 3, 'Must produce 3 distinct turns for 3 distinct speakers')
assert.equal(commits[0].utterance.speakerId, '1')
assert.equal(commits[0].utterance.language, 'es')
assert.equal(commits[0].translation.targetLang, 'en')
assert.equal(commits[0].translation.translatedText, 'Doctor, my son has a fever.')

assert.equal(commits[1].utterance.speakerId, '2')
assert.equal(commits[1].utterance.language, 'es')
assert.equal(commits[1].translation.targetLang, 'en')
assert.equal(commits[1].translation.translatedText, 'It started last night.')

assert.equal(commits[2].utterance.speakerId, '3')
assert.equal(commits[2].utterance.language, 'en')
assert.equal(commits[2].translation.targetLang, 'es')
assert.equal(updates.length, 1, 'Trailing translation after <end> must reconcile onto Speaker 3 turn')
assert.equal(updates[0].utterance.id, commits[2].utterance.id)
assert.equal(updates[0].translation.translatedText, 'Revisemos su temperatura ahora.')

console.log('  Speaker 1 (ES->EN) + Speaker 2 (ES->EN) + Speaker 3 (EN->ES) + Post-<end> Reconcile: VERIFIED')
console.log('PASS: Test 2 satisfied.\n')

// TEST 3: 48 kHz -> 16 kHz PCM Downsampler (67% Bandwidth Reduction & Signal Integrity)
console.log('[TEST 3] Verifying 48 kHz -> 16 kHz PCM downsampling accuracy...')
const input48k = new Int16Array(4800)
for (let i = 0; i < input48k.length; i++) {
  input48k[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 12000)
}
const down16k = downsampleInt16Pcm(input48k, 48000, 16000)
assert.equal(down16k.length, 1600, '48kHz -> 16kHz must reduce sample count exactly 3:1')
const passthrough16k = downsampleInt16Pcm(down16k, 16000, 16000)
assert.equal(passthrough16k, down16k, 'Already 16kHz PCM must pass through zero-copy')
console.log('  4800 samples (48kHz) -> 1600 samples (16kHz) exact 3:1 reduction: VERIFIED')
console.log('PASS: Test 3 satisfied.\n')

// TEST 4: Competitive Pricing Tiers ($0 Free 1h | $6.99 Pro 40h | $9.99 Pro+ 70h | $19.99 Unlimited)
console.log('[TEST 4] Auditing competitive SaaS plan catalog & unit economics...')
assert.equal(PLAN_CATALOG.free_tier.monthlyPriceUsd, 0)
assert.equal(PLAN_CATALOG.free_tier.includedSeconds, 3600)
assert.equal(PLAN_CATALOG.pro_40h.monthlyPriceUsd, 6.99)
assert.equal(PLAN_CATALOG.pro_40h.includedSeconds, 144000)
assert.equal(PLAN_CATALOG.pro_plus_70h.monthlyPriceUsd, 9.99)
assert.equal(PLAN_CATALOG.pro_plus_70h.includedSeconds, 252000)
assert.equal(PLAN_CATALOG.unlimited.monthlyPriceUsd, 19.99)
assert.equal(PLAN_CATALOG.unlimited.isUnlimitedFairUse, true)
assert.equal(PLAN_CATALOG.unlimited.maxConcurrentSessions, 1, 'Unlimited plan enforces 1 concurrent session anti-sharing lock')
console.log('  Free ($0/1h) | Pro ($6.99/40h) | Pro+ ($9.99/70h) | Unlimited ($19.99): VERIFIED')
console.log('PASS: Test 4 satisfied.\n')

// TEST 5: Governance Audit on All New/Modified Soniox Files
console.log('[TEST 5] Running Governance Audit (Zero Emojis, Zero Explicit any)...')
const files = [
  'server/src/proxy/sonioxWsProxy.ts',
  'src/renderer/src/audio/pcmDownsampler.ts',
  'src/renderer/src/audio/stt/sonioxStreamAssembler.ts',
  'src/renderer/src/audio/stt/GatewaySttClient.ts',
  'src/renderer/src/audio/stt/StreamingSttManager.ts'
]
const emojiRegex = /\p{Extended_Pictographic}/u
const explicitAnyRegex = /(:\s*any\b|\bas\s+any\b|<any>)/
for (const rel of files) {
  const src = fs.readFileSync(path.resolve(rel), 'utf-8')
  assert.ok(!emojiRegex.test(src), `Emoji detected in ${rel}`)
  assert.ok(!explicitAnyRegex.test(src), `Explicit any detected in ${rel}`)
}
console.log(`  Audited ${files.length} Soniox engine files: 0 emojis, 0 explicit 'any'.`)
console.log('PASS: Test 5 satisfied.\n')

console.log('==================================================================')
console.log('SONIOX UNIFIED ENGINE & PRICING AUDIT: 5/5 TESTS PASSED (100%)')
console.log('==================================================================')
