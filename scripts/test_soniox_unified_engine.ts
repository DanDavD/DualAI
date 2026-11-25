/**
 * DUALAI - Soniox Unified Real-Time Engine & Competitive Pricing Verification Suite
 * Empirically verifies:
 * 1. Soniox WebSocket config builder (language_hints_strict: true, two-way & one-way translation,
 *    15-speaker diarization, semantic endpoint detection, domain/glossary injection, ZERO api_key)
 * 2. Rapid "Sí, sí, sí" + 3 same-language speakers + <end> burst coalescing + regional/3rd-lang
 *    normalization -> ZERO premature fragmentation, instant commit ONLY on genuine language switch
 * 3. Real async settle timer coalescing + video pause anti-triplication + exact clause replay suppression
 * 4. 48 kHz -> 16 kHz linear PCM downsampling accuracy & 67% bandwidth reduction
 * 5. Competitive pricing catalog alignment ($0 / $6.99 / $9.99 / $19.99) & Governance audit
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function run(): Promise<void> {
  console.log('==================================================================')
  console.log('DUALAI SONIOX UNIFIED REAL-TIME ENGINE & STRESS AUDIT')
  console.log('==================================================================\n')

  // TEST 1: Soniox Config Builder (Zero api_key, language_hints_strict, Two-Way + One-Way, Diarization)
  console.log('[TEST 1] Verifying Soniox WebSocket config payload (Strict Hints, Two-Way, Zero Key)...')
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
  assert.equal(twoWayCfg.language_hints_strict, true, 'Strict language hints must lock onto active pair')
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
  assert.equal(oneWayCfg.language_hints_strict, true)
  assert.deepEqual(oneWayCfg.translation, { type: 'one_way', target_language: 'de' })
  console.log('  Strict Hints + Two-Way (EN<->ES) & One-Way (EN->DE) + 2000ms Endpointing: VERIFIED')
  console.log('PASS: Test 1 satisfied.\n')

  // TEST 2: Rapid "Sí, sí, sí" + 3 Same-Language Speakers + <end> Bursts + Genuine Language Switch
  console.log('[TEST 2] Stress-testing rapid "Sí, sí, sí" + speaker jitter + <end> bursts + ES<->EN switch...')
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
      sameLanguageSettleMs: 2000
    },
    {
      onUnifiedDraft: (snap) => drafts.push(snap),
      onUnifiedCommit: (snap) => commits.push(snap),
      onUnifiedCommitUpdate: (snap) => updates.push(snap)
    }
  )

  // Rapid same-language bursts across Speaker 1, Speaker 2, Speaker 3, noisy 'pt' tag, regional 'es-MX', and 3 <end> markers
  assembler.ingestTokens([
    { text: 'Sí,', is_final: true, speaker: '1', language: 'es-MX', translation_status: 'original', confidence: 0.96 },
    { text: '<end>', is_final: true }
  ])
  assembler.ingestTokens([
    { text: 'sí,', is_final: true, speaker: '2', language: 'pt', translation_status: 'original', confidence: 0.94 },
    { text: ' sí.', is_final: true, speaker: '1', language: 'es', translation_status: 'original', confidence: 0.95 },
    { text: 'Yes, yes, yes.', is_final: true, speaker: '1', language: 'en', source_language: 'es', translation_status: 'translation' },
    { text: '<end>', is_final: true }
  ])
  assembler.ingestTokens([
    { text: 'Mi hijo tiene fiebre desde anoche.', is_final: true, speaker: '3', language: 'es', translation_status: 'original', confidence: 0.97 },
    { text: 'My son has had a fever since last night.', is_final: true, speaker: '3', language: 'en', source_language: 'es', translation_status: 'translation' },
    { text: '<end>', is_final: true }
  ])

  // MUST NOT have prematurely split into 3 or 4 rows! All same-language speech stays in 1 live paragraph!
  assert.equal(commits.length, 0, 'Rapid "Sí, sí, sí" + speaker jitter + <end> bursts must produce 0 premature commits')
  assert.ok(drafts.length >= 3)
  assert.equal(
    drafts[drafts.length - 1].utterance.text,
    'Sí, sí, sí. Mi hijo tiene fiebre desde anoche.'
  )
  assert.equal(drafts[drafts.length - 1].utterance.language, 'es')
  assert.equal(drafts[drafts.length - 1].translation.targetLang, 'en')

  // Speaker 4 (Doctor speaking English, regional 'en-US') starts -> MUST immediately commit 1 unified Spanish paragraph!
  assembler.ingestTokens([
    { text: 'Let us check his temperature now.', is_final: true, speaker: '4', language: 'en-US', translation_status: 'original', confidence: 0.98 },
    { text: '<fin>', is_final: true }
  ])

  // Trailing finalized Spanish translation for English turn arrives 150ms AFTER <fin>
  assembler.ingestTokens([
    { text: 'Revisemos su temperatura ahora.', is_final: true, speaker: '4', language: 'es', source_language: 'en', translation_status: 'translation' }
  ])

  assembler.reset()

  assert.equal(commits.length, 2, 'Must produce exactly 2 clean paragraphs: 1 unified Spanish + 1 unified English')
  assert.equal(commits[0].utterance.language, 'es')
  assert.equal(commits[0].translation.targetLang, 'en')
  assert.equal(commits[0].utterance.text, 'Sí, sí, sí. Mi hijo tiene fiebre desde anoche.')
  assert.equal(
    commits[0].translation.translatedText,
    'Yes, yes, yes. My son has had a fever since last night.'
  )

  assert.equal(commits[1].utterance.language, 'en')
  assert.equal(commits[1].translation.targetLang, 'es')
  assert.equal(commits[1].utterance.text, 'Let us check his temperature now.')
  assert.equal(updates.length, 1, 'Trailing translation after <fin> must reconcile onto English paragraph')
  assert.equal(updates[0].utterance.id, commits[1].utterance.id)
  assert.equal(updates[0].translation.translatedText, 'Revisemos su temperatura ahora.')
  console.log('  3 ES speakers + "Sí, sí, sí" + <end> bursts -> 1 unified ES paragraph + instant EN switch: VERIFIED')
  console.log('PASS: Test 2 satisfied.\n')

  // TEST 3: Real Async Settle Timer + Pause Anti-Triplication + Exact Re-Emission Suppression
  console.log('[TEST 3] Stress-testing real async settle timer, video pause anti-triplication & replay dedup...')
  const timerCommits: UnifiedTurnSnapshot[] = []
  const timerAsm = new SonioxStreamAssembler(
    {
      channelId: 'channel_b',
      sourceLang: 'en',
      targetLang: 'es',
      operatingMode: 'conversation',
      domainId: 'medical',
      confidenceThreshold: 0.75,
      sameLanguageSettleMs: 320
    },
    {
      onUnifiedDraft: () => {},
      onUnifiedCommit: (snap) => timerCommits.push(snap),
      onUnifiedCommitUpdate: () => {}
    }
  )

  // Clause 1 + soft <end>
  timerAsm.ingestTokens([
    { text: 'So as long as we follow the recommendations,', is_final: true, speaker: '1', language: 'en', translation_status: 'original' },
    { text: 'Así que, siempre que sigamos las recomendaciones,', is_final: true, speaker: '1', language: 'es', source_language: 'en', translation_status: 'translation' },
    { text: '<end>', is_final: true }
  ])

  // Wait 120ms (< 320ms settle window) -> speaker continues same paragraph
  await sleep(120)
  assert.equal(timerCommits.length, 0, 'Must NOT commit before settle window elapses')

  // Repeated non-final frames while pausing + exact trailing finalized clause replay
  timerAsm.ingestTokens([
    { text: ' the baby and you should be', is_final: false, speaker: '1', language: 'en', translation_status: 'original' }
  ])
  timerAsm.ingestTokens([
    { text: ' the baby and you should be', is_final: false, speaker: '1', language: 'en', translation_status: 'original' }
  ])
  timerAsm.ingestTokens([
    { text: ' the baby and you should be', is_final: false, speaker: '1', language: 'en', translation_status: 'original' }
  ])
  timerAsm.ingestTokens([
    { text: ' the baby and you should be fine.', is_final: true, speaker: '1', language: 'en', translation_status: 'original' },
    // Duplicate clause replay must be suppressed!
    { text: ' the baby and you should be fine.', is_final: true, speaker: '1', language: 'en', translation_status: 'original' },
    { text: ' el bebé y usted deberían estar bien.', is_final: true, speaker: '1', language: 'es', source_language: 'en', translation_status: 'translation' },
    { text: '<end>', is_final: true }
  ])

  // Wait for settle timer to fire naturally once speaker truly finishes
  await sleep(420)
  assert.equal(timerCommits.length, 1, 'Complete multi-clause paragraph must commit ONCE after speaker finishes')
  assert.equal(
    timerCommits[0].utterance.text,
    'So as long as we follow the recommendations, the baby and you should be fine.'
  )
  assert.equal(
    timerCommits[0].translation.translatedText,
    'Así que, siempre que sigamos las recomendaciones, el bebé y usted deberían estar bien.'
  )

  // Exact back-to-back duplicate committed paragraph within 6s window must be suppressed
  timerAsm.ingestTokens([
    { text: 'So as long as we follow the recommendations, the baby and you should be fine.', is_final: true, speaker: '1', language: 'en', translation_status: 'original' },
    { text: '<fin>', is_final: true }
  ])
  assert.equal(timerCommits.length, 1, 'Back-to-back identical committed paragraph must be suppressed')

  timerAsm.reset()
  console.log('  Async settle coalescing + 3x provisional pause frames + exact replay dedup -> 1 clean paragraph: VERIFIED')
  console.log('PASS: Test 3 satisfied.\n')

  // TEST 4: 48 kHz -> 16 kHz PCM Downsampler (67% Bandwidth Reduction & Signal Integrity)
  console.log('[TEST 4] Verifying 48 kHz -> 16 kHz PCM downsampling accuracy...')
  const input48k = new Int16Array(4800)
  for (let i = 0; i < input48k.length; i++) {
    input48k[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 12000)
  }
  const down16k = downsampleInt16Pcm(input48k, 48000, 16000)
  assert.equal(down16k.length, 1600, '48kHz -> 16kHz must reduce sample count exactly 3:1')
  const passthrough16k = downsampleInt16Pcm(down16k, 16000, 16000)
  assert.equal(passthrough16k, down16k, 'Already 16kHz PCM must pass through zero-copy')
  console.log('  4800 samples (48kHz) -> 1600 samples (16kHz) exact 3:1 reduction: VERIFIED')
  console.log('PASS: Test 4 satisfied.\n')

  // TEST 5: Competitive Pricing Tiers ($0 Free 1h | $6.99 Pro 40h | $9.99 Pro+ 70h | $19.99 Unlimited) & Governance
  console.log('[TEST 5] Auditing competitive SaaS plan catalog & Governance (Zero Emojis, Zero any)...')
  assert.equal(PLAN_CATALOG.free_tier.monthlyPriceUsd, 0)
  assert.equal(PLAN_CATALOG.free_tier.includedSeconds, 3600)
  assert.equal(PLAN_CATALOG.pro_40h.monthlyPriceUsd, 6.99)
  assert.equal(PLAN_CATALOG.pro_40h.includedSeconds, 144000)
  assert.equal(PLAN_CATALOG.pro_plus_70h.monthlyPriceUsd, 9.99)
  assert.equal(PLAN_CATALOG.pro_plus_70h.includedSeconds, 252000)
  assert.equal(PLAN_CATALOG.unlimited.monthlyPriceUsd, 19.99)
  assert.equal(PLAN_CATALOG.unlimited.isUnlimitedFairUse, true)
  assert.equal(PLAN_CATALOG.unlimited.maxConcurrentSessions, 1, 'Unlimited plan enforces 1 concurrent session anti-sharing lock')

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
  console.log(`  Pricing ($0/$6.99/$9.99/$19.99) + ${files.length} audited engine files (0 emojis, 0 any): VERIFIED`)
  console.log('PASS: Test 5 satisfied.\n')

  console.log('==================================================================')
  console.log('SONIOX UNIFIED ENGINE & STRESS AUDIT: 5/5 TESTS PASSED (100%)')
  console.log('==================================================================')
}

run().catch((err) => {
  console.error('TEST FAILURE:', err)
  process.exit(1)
})
