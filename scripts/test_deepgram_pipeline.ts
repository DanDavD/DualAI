/**
 * DUALAI - Deepgram Real-Time Engine, Speaker Diarization, Paragraph Rules & Provider Switch Suite
 * Empirically verifies:
 * 1. STT_PROVIDER='deepgram' strictly disables Soniox ($0 Soniox usage even when SONIOX_API_KEY is set),
 *    while STT_PROVIDER='soniox' reactivates Soniox immediately with zero code changes.
 * 2. buildDeepgramListenUrl generates Nova-3 streaming URLs with diarize=true, smart_format=true,
 *    punctuate=true, language=multi (Conversation mode) vs monolingual (Translate mode), and
 *    deduplicated keyterm glossary params (never embedding API keys).
 * 3. Deepgram WS Proxy end-to-end: Lazy Dial -> Wake-on-Audio -> Idle Hibernation ($0 idle billing)
 *    -> KeepAlive absorption -> Re-Wake -> Fast Mute Hibernation -> Strict 1-socket cap (4003).
 * 4. splitDeepgramWordsBySpeaker + ParagraphTurnAccumulator enforce all paragraph invariants:
 *    - Same speaker across brief pauses (< 2.2s) coalesces into ONE cohesive paragraph
 *    - Same speaker after >= 2.2s acoustic or wall-clock pause splits cleanly
 *    - Interrupting speaker mid-frame splits immediately (0ms) with zero provisional bleed
 *    - 75+ word continuous monologue splits cleanly at sentence punctuation (. ? !)
 *    - Exact duplicate clause replay (>= 12 chars) is suppressed
 * 5. Gemini bidirectional Conversation prompt builder vs one-way Translate prompt builder
 *    + Governance audit (0 emojis, 0 explicit any).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import { createGatewayServer } from '../server/src/index.ts'
import { loadGatewayConfig, resolveActiveSttProvider } from '../server/src/config.ts'
import {
  buildDeepgramListenUrl,
  resolveDeepgramModelForDomain
} from '../server/src/proxy/deepgramWsProxy.ts'
import { buildGeminiTranslationPrompt } from '../server/src/proxy/geminiStreamProxy.ts'
import { splitDeepgramWordsBySpeaker } from '../src/renderer/src/audio/stt/GatewaySttClient.ts'
import {
  DEFAULT_PAUSE_COMMIT_MS,
  ParagraphTurnAccumulator
} from '../src/renderer/src/audio/paragraphAccumulator.ts'
import {
  resolveAudioRoutingPolicy,
  resolveTranslationPairForUtterance
} from '../src/renderer/src/audio/audioRoutingPolicy.ts'
import { TranscriptUtterance } from '../src/types/stt.ts'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function run(): Promise<void> {
  console.log('==================================================================')
  console.log('DUALAI DEEPGRAM NOVA-3 + GEMINI PIPELINE & PROVIDER SWITCH AUDIT')
  console.log('==================================================================\n')

  // TEST 1: STT_PROVIDER Switch (Strictly Disables Soniox Without Deleting SONIOX_API_KEY)
  console.log('[TEST 1] Verifying STT_PROVIDER switch (deepgram / soniox / auto)...')
  const cfgDeepgram = loadGatewayConfig({
    nodeEnv: 'test',
    sttProvider: 'deepgram',
    sonioxApiKey: 'sk_soniox_kept_intact_12345',
    deepgramApiKey: 'dg_live_key_1234567890'
  })
  assert.equal(
    resolveActiveSttProvider(cfgDeepgram),
    'deepgram',
    'STT_PROVIDER=deepgram must strictly select Deepgram even when SONIOX_API_KEY is present'
  )

  const cfgSoniox = loadGatewayConfig({
    nodeEnv: 'test',
    sttProvider: 'soniox',
    sonioxApiKey: 'sk_soniox_kept_intact_12345',
    deepgramApiKey: 'dg_live_key_1234567890'
  })
  assert.equal(
    resolveActiveSttProvider(cfgSoniox),
    'soniox',
    'STT_PROVIDER=soniox must reactivate Soniox immediately'
  )

  const cfgAuto = loadGatewayConfig({
    nodeEnv: 'test',
    sttProvider: 'auto',
    sonioxApiKey: 'sk_soniox_kept_intact_12345',
    deepgramApiKey: 'dg_live_key_1234567890'
  })
  assert.equal(
    resolveActiveSttProvider(cfgAuto),
    'soniox',
    'STT_PROVIDER=auto must preserve legacy Soniox preference when key is configured'
  )
  console.log('  STT_PROVIDER switch (deepgram -> $0 Soniox, soniox -> instant restore): VERIFIED')
  console.log('PASS: Test 1 satisfied.\n')

  // TEST 2: Deepgram Listen URL Builder (Nova-3 Multilingual + Diarization + Keyterm Glossary)
  console.log('[TEST 2] Verifying Deepgram Nova-3 listen URL builder...')
  const convoUrl = buildDeepgramListenUrl({
    model: 'nova-3',
    sampleRate: 16000,
    sourceLang: 'en',
    targetLang: 'es',
    operatingMode: 'conversation',
    endpointing: 300,
    glossaryTerms: ['Amoxicillin', 'amoxicillin', 'Dyspnea', '   ', 'Hypertension']
  })
  const parsedConvo = new URL(convoUrl)
  assert.equal(parsedConvo.searchParams.get('model'), 'nova-3')
  assert.equal(parsedConvo.searchParams.get('language'), 'multi')
  assert.equal(parsedConvo.searchParams.get('endpointing'), '300', 'Bilingual language=multi must enforce >= 300ms endpointing for <=1.0s post-speech latency')
  assert.equal(parsedConvo.searchParams.get('diarize'), 'true')
  assert.equal(parsedConvo.searchParams.get('smart_format'), 'true')
  assert.equal(parsedConvo.searchParams.get('punctuate'), 'true')
  assert.equal(parsedConvo.searchParams.get('interim_results'), 'true')

  // Domain-aware model selection: Medical -> nova-3-medical, others -> nova-3 (same pricing tier)
  assert.equal(resolveDeepgramModelForDomain('nova-3', 'medical'), 'nova-3-medical')
  assert.equal(resolveDeepgramModelForDomain('nova-3', 'general'), 'nova-3')
  assert.equal(resolveDeepgramModelForDomain('nova-3', 'legal'), 'nova-3')
  assert.equal(resolveDeepgramModelForDomain('nova-3', 'technical'), 'nova-3')
  assert.equal(resolveDeepgramModelForDomain('nova-3', 'business'), 'nova-3')
  const medicalUrl = buildDeepgramListenUrl({
    model: 'nova-3',
    domainId: 'medical',
    sampleRate: 16000,
    sourceLang: 'en',
    targetLang: 'es',
    operatingMode: 'conversation',
    endpointing: 250
  })
  const parsedMedical = new URL(medicalUrl)
  assert.equal(parsedMedical.searchParams.get('model'), 'nova-3-medical')
  assert.equal(parsedMedical.searchParams.get('language'), 'multi')
  assert.equal(parsedMedical.searchParams.get('endpointing'), '300')
  assert.deepEqual(parsedConvo.searchParams.getAll('keyterm'), [
    'Amoxicillin',
    'Dyspnea',
    'Hypertension'
  ])
  assert.equal(convoUrl.includes('api_key'), false, 'URL must never embed API keys')

  const oneWayUrl = buildDeepgramListenUrl({
    model: 'nova-3',
    sampleRate: 16000,
    sourceLang: 'es',
    targetLang: 'en',
    operatingMode: 'translate',
    endpointing: 650,
    glossaryTerms: ['Metformina']
  })
  const parsedOneWay = new URL(oneWayUrl)
  assert.equal(parsedOneWay.searchParams.get('language'), 'es')
  assert.equal(parsedOneWay.searchParams.get('endpointing'), '650')
  assert.deepEqual(parsedOneWay.searchParams.getAll('keyterm'), ['Metformina'])

  // Nova-2 in conversation mode must NOT emit language=multi (Nova-2 rejects multi with HTTP 400)
  const nova2ConvoUrl = buildDeepgramListenUrl({
    model: 'nova-2',
    sampleRate: 16000,
    sourceLang: 'en',
    targetLang: 'es',
    operatingMode: 'conversation',
    endpointing: 300,
    glossaryTerms: ['Amoxicillin']
  })
  const parsedNova2 = new URL(nova2ConvoUrl)
  assert.equal(parsedNova2.searchParams.get('language'), 'en', 'Nova-2 must never emit language=multi')
  assert.deepEqual(parsedNova2.searchParams.getAll('keywords'), ['Amoxicillin'])
  assert.deepEqual(parsedNova2.searchParams.getAll('keyterm'), [])
  console.log('  Nova-3 language=multi + diarize=true + deduplicated keyterms + Nova-2 safety: VERIFIED')
  console.log('PASS: Test 2 satisfied.\n')

  // TEST 3: Live Deepgram Proxy (Zero Soniox Dial, Lazy Dial, Idle Hibernation, Re-Wake, Mute Hibernate, 4003 Cap)
  console.log('[TEST 3] Testing Deepgram WS Proxy Lazy Dial, Hibernation, Re-Wake & $0 Soniox Guarantee...')
  let sonioxDialCount = 0
  let deepgramConnections = 0
  let deepgramActive = 0
  let deepgramBytes = 0
  let deepgramKeepalives = 0
  let deepgramFinalizes = 0
  let deepgramCloseStreams = 0
  let lastDeepgramRequestUrl = ''

  const mockSonioxWss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => mockSonioxWss.once('listening', resolve))
  const mockSonioxUrl = `ws://127.0.0.1:${(mockSonioxWss.address() as AddressInfo).port}`
  mockSonioxWss.on('connection', (sock) => {
    sonioxDialCount++
    sock.close()
  })

  const mockDeepgramWss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => mockDeepgramWss.once('listening', resolve))
  const mockDeepgramUrl = `ws://127.0.0.1:${(mockDeepgramWss.address() as AddressInfo).port}`

  mockDeepgramWss.on('connection', (sock, req) => {
    deepgramConnections++
    deepgramActive++
    lastDeepgramRequestUrl = req.url || ''
    sock.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        deepgramBytes += buf.length
        sock.send(
          JSON.stringify({
            type: 'Results',
            is_final: true,
            speech_final: false,
            duration: 0.4,
            channel: {
              alternatives: [
                {
                  transcript: 'Buenos días doctor.',
                  confidence: 0.97,
                  words: [
                    { word: 'buenos', punctuated_word: 'Buenos', start: 0.1, end: 0.2, confidence: 0.97, speaker: 0 },
                    { word: 'dias', punctuated_word: 'días', start: 0.2, end: 0.3, confidence: 0.96, speaker: 0 },
                    { word: 'doctor', punctuated_word: 'doctor.', start: 0.3, end: 0.5, confidence: 0.98, speaker: 0 }
                  ]
                }
              ]
            }
          })
        )
        return
      }
      const parsed = JSON.parse(data.toString()) as { type?: string }
      if (parsed.type === 'KeepAlive') deepgramKeepalives++
      if (parsed.type === 'Finalize') {
        deepgramFinalizes++
        sock.send(JSON.stringify({ type: 'Results', is_final: true, from_finalize: true, channel: { alternatives: [{ transcript: '', confidence: 1, words: [] }] } }))
      }
      if (parsed.type === 'CloseStream') deepgramCloseStreams++
    })
    sock.on('close', () => {
      deepgramActive--
    })
  })

  const gw = await createGatewayServer({
    nodeEnv: 'test',
    port: 0,
    host: '127.0.0.1',
    sttProvider: 'deepgram',
    sonioxApiKey: 'sk_soniox_disabled_key_12345',
    sonioxWsUrl: mockSonioxUrl,
    deepgramApiKey: 'dg_test_key_hibernate_12345',
    deepgramModel: 'nova-3',
    deepgramWsUrl: mockDeepgramUrl,
    deepgramIdleHibernateMs: 550,
    deepgramMuteHibernateMs: 200,
    deepgramFinalizeDrainMs: 150,
    quotaMeterIntervalMs: 5000
  })

  try {
    // Health endpoint check
    const healthRes = await fetch(`${gw.baseUrl}/v1/health`)
    const health = (await healthRes.json()) as {
      activeEngine: string
      sttProviderMode: string
      deepgramConfigured: boolean
      sonioxConfigured: boolean
    }
    assert.equal(health.activeEngine, 'deepgram-gemini')
    assert.equal(health.sttProviderMode, 'deepgram')
    assert.equal(health.deepgramConfigured, true)
    assert.equal(health.sonioxConfigured, true)

    const signInRes = await fetch(`${gw.baseUrl}/v1/auth/dev-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'deepgram.test@dualai.test' })
    })
    const signIn = (await signInRes.json()) as { accessToken: string }

    const clientMessages: Array<{ type?: string; provider?: string }> = []
    let clientClosed = false

    const clientWs = new WebSocket(
      `${gw.wsUrl}/v1/stt?sourceLang=en&targetLang=es&mode=conversation&terms=Amoxicillin,Dyspnea`,
      ['dualai-auth', signIn.accessToken]
    )
    clientWs.on('message', (raw) => {
      try {
        clientMessages.push(JSON.parse(raw.toString()) as { type?: string; provider?: string })
      } catch {
        // ignore
      }
    })
    clientWs.on('close', () => {
      clientClosed = true
    })

    await new Promise<void>((resolve, reject) => {
      clientWs.once('open', resolve)
      clientWs.once('error', reject)
    })

    await sleep(120)
    // 1. Lazy Dial Check: handshake sent, ZERO Deepgram & ZERO Soniox connections opened yet!
    assert.ok(
      clientMessages.some((m) => m.type === 'dualai_quota' && m.provider === 'deepgram-nova-3'),
      'Client must receive deepgram-nova-3 provider handshake immediately'
    )
    assert.equal(deepgramConnections, 0, 'Lazy dial must open 0 Deepgram connections before audio arrives')
    assert.equal(sonioxDialCount, 0, 'Soniox must NEVER be dialed when STT_PROVIDER=deepgram')

    // KeepAlive while hibernated must be absorbed silently
    clientWs.send(JSON.stringify({ type: 'KeepAlive' }))
    await sleep(60)
    assert.equal(deepgramKeepalives, 0, 'KeepAlive must be absorbed when Deepgram is not awake')

    // 2. Wake-on-Audio #1
    clientWs.send(Buffer.alloc(1536, 7))
    await sleep(160)
    assert.equal(deepgramConnections, 1, 'First PCM frame must wake Deepgram')
    assert.equal(deepgramActive, 1)
    assert.equal(deepgramBytes, 1536, 'Buffered PCM must flush intact on upstream open')
    assert.ok(lastDeepgramRequestUrl.includes('model=nova-3'))
    assert.ok(lastDeepgramRequestUrl.includes('language=multi'))
    assert.ok(lastDeepgramRequestUrl.includes('diarize=true'))
    assert.ok(lastDeepgramRequestUrl.includes('keyterm=Amoxicillin'))
    assert.ok(clientMessages.some((m) => m.type === 'Results'), 'Deepgram transcript must relay to client')

    // 3. Idle Hibernation ($0 idle billing while client WS remains OPEN)
    await sleep(800)
    assert.equal(deepgramActive, 0, 'Deepgram upstream must hibernate cleanly after idle timeout')
    assert.equal(clientClosed, false, 'Client WS must remain OPEN transparently during hibernation')
    assert.ok(deepgramFinalizes >= 1, 'Finalize must be sent before hibernation')
    assert.ok(deepgramCloseStreams >= 1, 'CloseStream must be sent before closing Deepgram socket')

    // KeepAlive while hibernated must be absorbed
    clientWs.send(JSON.stringify({ type: 'KeepAlive' }))
    await sleep(60)
    assert.equal(deepgramKeepalives, 0, 'KeepAlive must not be forwarded while hibernated')

    // 4. Seamless Re-Wake #2 + Fast Mute/Pause Hibernation
    clientWs.send(Buffer.alloc(1536, 9))
    await sleep(140)
    assert.equal(deepgramConnections, 2, 'New speech must re-wake Deepgram seamlessly')
    assert.equal(deepgramActive, 1)

    clientWs.send(JSON.stringify({ type: 'pause' }))
    await sleep(420)
    assert.equal(deepgramActive, 0, 'Explicit pause/mute must fast-hibernate Deepgram upstream')
    assert.equal(clientClosed, false)

    // 5. Strict 1-Socket Concurrency Cap (4003)
    const secondCloseCode = await new Promise<number>((resolve) => {
      const ws2 = new WebSocket(`${gw.wsUrl}/v1/stt?sourceLang=en&targetLang=es`, [
        'dualai-auth',
        signIn.accessToken
      ])
      ws2.on('close', (code) => resolve(code))
      ws2.on('error', () => resolve(4003))
    })
    assert.equal(secondCloseCode, 4003, 'Deepgram proxy must cap each user to 1 concurrent socket (4003)')
    assert.equal(sonioxDialCount, 0, 'Soniox must remain at 0 connections throughout entire session')

    clientWs.close()
  } finally {
    await gw.close()
    await new Promise<void>((resolve) => mockDeepgramWss.close(() => resolve()))
    await new Promise<void>((resolve) => mockSonioxWss.close(() => resolve()))
  }
  console.log('  Zero Soniox Dial + Lazy Dial + Idle Hibernate + Re-Wake + Mute Hibernate + 4003 Cap: VERIFIED')
  console.log('PASS: Test 3 satisfied.\n')

  // TEST 4: Deepgram Multi-Speaker Interruption + 2.2s Pause + Zero Interim Bleed + 75-Word Monologue Split
  console.log('[TEST 4] Testing Deepgram speaker splitting & ParagraphTurnAccumulator invariants...')
  assert.equal(DEFAULT_PAUSE_COMMIT_MS, 2200, 'Default pause commit threshold must be 2200ms')

  // 4a. Mid-frame speaker interruption splitting
  const splitSegs = splitDeepgramWordsBySpeaker({
    words: [
      { word: 'i', punctuated_word: 'I', start: 1.0, end: 1.1, confidence: 0.98, speaker: 0 },
      { word: 'agree.', punctuated_word: 'agree.', start: 1.1, end: 1.4, confidence: 0.96, speaker: 0 },
      { word: 'pero', punctuated_word: 'Pero', start: 1.45, end: 1.7, confidence: 0.95, speaker: 1 },
      { word: 'espere.', punctuated_word: 'espere.', start: 1.7, end: 2.0, confidence: 0.94, speaker: 1 }
    ],
    fallbackTranscript: 'I agree. Pero espere.',
    fallbackConfidence: 0.96,
    channelId: 'channel_b',
    utteranceIdPrefix: 'dg-test',
    confidenceThreshold: 0.75
  })
  assert.equal(splitSegs.length, 2, 'Mid-frame Speaker 0 -> Speaker 1 must split into 2 segments')
  assert.equal(splitSegs[0].speakerId, '1')
  assert.equal(splitSegs[0].text, 'I agree.')
  assert.equal(splitSegs[1].speakerId, '2')
  assert.equal(splitSegs[1].text, 'Pero espere.')

  // 4b. ParagraphTurnAccumulator rules (brief pause coalescing, zero interim bleed, instant speaker split, acoustic pause split, 75-word split)
  const drafts: TranscriptUtterance[] = []
  const commits: TranscriptUtterance[] = []
  const acc = new ParagraphTurnAccumulator(
    {
      onDraftUpdate: (d) => drafts.push(d),
      onParagraphCommit: (c) => commits.push(c)
    },
    2200,
    75
  )

  const makeUtterance = (
    text: string,
    speakerId: string,
    startMs: number,
    endMs: number,
    isFinal: boolean
  ): TranscriptUtterance => ({
    id: `u-${startMs}`,
    channelId: 'channel_b',
    speakerId,
    speakerLabel: `Speaker ${speakerId}`,
    language: 'es',
    text,
    tokens: [
      {
        id: `t-${startMs}`,
        text,
        confidence: 0.96,
        isLowConfidence: false,
        startTimeMs: startMs,
        endTimeMs: endMs,
        isPunctuated: true,
        speakerId
      }
    ],
    isFinal,
    timestampMs: Date.now(),
    durationMs: endMs - startMs,
    averageConfidence: 0.96,
    receivedAtMs: Date.now()
  })

  // Same speaker brief pause (800ms < 2200ms) -> stays in 1 paragraph
  acc.pushFinalSegment(makeUtterance('Yo quiero saber si puedo poner una denuncia.', '1', 1000, 3000, true))
  acc.pushFinalSegment(makeUtterance('Porque dijo que había música en mi casa.', '1', 3800, 5500, true))
  assert.equal(commits.length, 0, 'Same speaker across 800ms breath must stay in 1 paragraph')

  // Duplicate finalized clause replay must be suppressed
  acc.pushFinalSegment(makeUtterance('Porque dijo que había música en mi casa.', '1', 5550, 5600, true))
  assert.equal(
    drafts[drafts.length - 1].text,
    'Yo quiero saber si puedo poner una denuncia. Porque dijo que había música en mi casa.'
  )

  // Provisional interim from interrupting Speaker 2 must NOT bleed into Speaker 1 draft
  const draftCountBeforeBleed = drafts.length
  acc.pushInterim(makeUtterance('Un momento señora', '2', 5700, 6100, false))
  assert.equal(drafts.length, draftCountBeforeBleed, 'Interrupting speaker interim must never bleed into Speaker 1 box')

  // Finalized interruption from Speaker 2 -> commits Speaker 1 IMMEDIATELY (0ms)!
  acc.pushFinalSegment(makeUtterance('Un momento señora, déjeme revisar su caso.', '2', 5700, 7200, true))
  assert.equal(commits.length, 1, 'Speaker 2 interruption must commit Speaker 1 immediately')
  assert.equal(commits[0].speakerId, '1')
  assert.equal(
    commits[0].text,
    'Yo quiero saber si puedo poner una denuncia. Porque dijo que había música en mi casa.'
  )

  // Same Speaker 2 pauses acoustically for 2,600ms (>= 2,200ms) -> splits into a new paragraph!
  acc.pushFinalSegment(makeUtterance('Aquí veo la notificación del mes pasado.', '2', 9800, 11500, true))
  assert.equal(commits.length, 2, 'Acoustic pause >= 2.2s for same speaker must split cleanly')
  assert.equal(commits[1].speakerId, '2')
  assert.equal(commits[1].text, 'Un momento señora, déjeme revisar su caso.')

  // Nonstop 75+ word monologue ending with sentence punctuation -> splits cleanly!
  const longSentence = `${Array.from({ length: 76 }, (_, i) => `palabra${i + 1}`).join(' ')}.`
  acc.pushFinalSegment(makeUtterance(longSentence, '2', 11700, 15000, true))
  assert.equal(commits.length, 3, 'Continuous >= 75-word monologue ending in period must split cleanly')
  assert.equal(acc.hasActiveTurn('channel_b'), false)
  acc.reset()
  // 4c. Majority-vote language detection (cognate "No" tagged "en" followed by Spanish words -> "es")
  const cognateSegs = splitDeepgramWordsBySpeaker({
    words: [
      { word: 'no', punctuated_word: 'No,', start: 0.0, end: 0.2, confidence: 0.95, speaker: 0, language: 'en' },
      { word: 'tengo', punctuated_word: 'tengo', start: 0.2, end: 0.5, confidence: 0.96, speaker: 0, language: 'es' },
      { word: 'dolor', punctuated_word: 'dolor', start: 0.5, end: 0.8, confidence: 0.97, speaker: 0, language: 'es' },
      { word: 'fuerte.', punctuated_word: 'fuerte.', start: 0.8, end: 1.1, confidence: 0.97, speaker: 0, language: 'es' }
    ],
    fallbackTranscript: 'No, tengo dolor fuerte.',
    fallbackConfidence: 0.96,
    channelId: 'channel_b',
    utteranceIdPrefix: 'dg-cognate',
    confidenceThreshold: 0.75
  })
  assert.equal(cognateSegs.length, 1, 'Opening cognate must NOT split Spanish sentence into two segments')
  assert.equal(cognateSegs[0].language, 'es', 'Majority vote must classify cognate-leading Spanish sentence as es')
  assert.equal(cognateSegs[0].tokens[0].startTimeMs, 0, '0ms word start timestamp must be preserved')

  // 4d. Hibernation/re-wake clock reset + omitted language clause inheritance
  const resetCommits: TranscriptUtterance[] = []
  const resetDrafts: TranscriptUtterance[] = []
  const resetAcc = new ParagraphTurnAccumulator(
    {
      onDraftUpdate: (d) => resetDrafts.push(d),
      onParagraphCommit: (c) => resetCommits.push(c)
    },
    2200,
    75
  )
  // WS #1 ends at 15,000ms in Spanish
  resetAcc.pushFinalSegment(makeUtterance('Tome una pastilla por la mañana.', '1', 12000, 15000, true))
  // WS #2 re-wakes briefly after (<2.2s wall clock) with clock reset to 100ms-600ms and omitted language ('')
  const omittedLangSeg = makeUtterance('Con agua.', '1', 100, 600, true)
  omittedLangSeg.language = ''
  resetAcc.pushFinalSegment(omittedLangSeg)
  assert.equal(resetCommits.length, 0, 'Omitted language after brief re-wake must inherit es and coalesce')
  assert.equal(resetDrafts[resetDrafts.length - 1].language, 'es', 'Active Spanish language must be preserved')
  // Now on WS #2 clock, speaker pauses 2,600ms (600ms -> 3200ms) -> MUST split cleanly despite earlier 15,000ms clock!
  resetAcc.pushFinalSegment(makeUtterance('Y regrese el viernes.', '1', 3200, 4500, true))
  assert.equal(resetCommits.length, 1, 'Acoustic pause >= 2.2s on WS #2 clock must still split cleanly after clock reset')
  assert.equal(resetCommits[0].text, 'Tome una pastilla por la mañana. Con agua.')
  resetAcc.reset()

  // 4e. Cross-paragraph duplicate suppression (prevents delayed Deepgram is_final after interim commit from repeating)
  const dedupCommits: TranscriptUtterance[] = []
  const dedupDrafts: TranscriptUtterance[] = []
  const dedupAcc = new ParagraphTurnAccumulator(
    {
      onDraftUpdate: (d) => dedupDrafts.push(d),
      onParagraphCommit: (c) => dedupCommits.push(c)
    },
    2200,
    75
  )
  dedupAcc.pushFinalSegment(
    makeUtterance('Please speak and share sentences. And I already introduced myself to the patient.', '1', 1000, 4000, true)
  )
  dedupAcc.pushInterim(
    makeUtterance("Oh, wonderful. I've done this before, I know the protocol. Let's go in. I'll let you go first. Okay. Thank", '1', 4100, 8000, false)
  )
  dedupAcc.commitChannel('channel_b')
  assert.equal(dedupCommits.length, 1)
  const draftsAfterCommit = dedupDrafts.length
  // Delayed Deepgram is_final arrives with already-committed substring -> MUST be completely suppressed!
  dedupAcc.pushFinalSegment(
    makeUtterance("Oh, wonderful. I've done this before, I know the protocol. Let's go in. I'll let you go first.", '1', 4100, 7500, true)
  )
  assert.equal(dedupAcc.hasActiveTurn('channel_b'), false, 'Delayed duplicate final replay must not open a new duplicate row')
  assert.equal(dedupDrafts.length, draftsAfterCommit, 'Delayed duplicate final replay must not emit a duplicate draft')
  dedupAcc.reset()

  // 4f. Option A speechFinal propagation (enables 0ms Gemini dispatch on Deepgram speech_final: true)
  const speechFinalFlags: boolean[] = []
  const sfAcc = new ParagraphTurnAccumulator(
    {
      onDraftUpdate: (_d, meta) => speechFinalFlags.push(Boolean(meta.isSpeechFinal)),
      onParagraphCommit: () => undefined
    },
    2200,
    75
  )
  const midClause = makeUtterance('How bad is your pain', '1', 1000, 2000, true)
  midClause.speechFinal = false
  sfAcc.pushFinalSegment(midClause)
  const endClause = makeUtterance('on a scale of zero to ten?', '1', 2100, 3200, true)
  endClause.speechFinal = true
  sfAcc.pushFinalSegment(endClause)
  assert.deepEqual(speechFinalFlags, [false, true], 'ParagraphTurnAccumulator must propagate speechFinal accurately')
  sfAcc.reset()

  // 4g. Mid-frame bilingual language switch with SAME Deepgram speaker number (speaker: 0 EN -> speaker: 0 ES)
  const sameSpeakerBilingual = splitDeepgramWordsBySpeaker({
    words: [
      { word: 'how', punctuated_word: 'How', start: 0.1, end: 0.2, confidence: 0.96, speaker: 0, language: 'en' },
      { word: 'bad', punctuated_word: 'bad', start: 0.2, end: 0.4, confidence: 0.96, speaker: 0, language: 'en' },
      { word: 'is', punctuated_word: 'is', start: 0.4, end: 0.5, confidence: 0.96, speaker: 0, language: 'en' },
      { word: 'it?', punctuated_word: 'it?', start: 0.5, end: 0.7, confidence: 0.96, speaker: 0, language: 'en' },
      { word: 'me', punctuated_word: 'Me', start: 0.8, end: 0.9, confidence: 0.95, speaker: 0, language: 'es' },
      { word: 'duele', punctuated_word: 'duele', start: 0.9, end: 1.1, confidence: 0.96, speaker: 0, language: 'es' },
      { word: 'mucho.', punctuated_word: 'mucho.', start: 1.1, end: 1.4, confidence: 0.97, speaker: 0, language: 'es' }
    ],
    fallbackTranscript: 'How bad is it? Me duele mucho.',
    fallbackConfidence: 0.96,
    channelId: 'channel_b',
    utteranceIdPrefix: 'dg-same-spk-bilingual',
    confidenceThreshold: 0.75
  })
  assert.equal(sameSpeakerBilingual.length, 2, 'Mid-frame EN->ES switch with same speaker must split into 2 segments')
  assert.equal(sameSpeakerBilingual[0].language, 'en')
  assert.equal(sameSpeakerBilingual[0].text, 'How bad is it?')
  assert.equal(sameSpeakerBilingual[1].language, 'es')
  assert.equal(sameSpeakerBilingual[1].text, 'Me duele mucho.')

  // 4h. Interim-only Speaker A interrupted by Speaker B in another language -> commits A with distinct turnId & starts fresh stack for B
  const interruptCommits: TranscriptUtterance[] = []
  const interruptDrafts: TranscriptUtterance[] = []
  const intAcc = new ParagraphTurnAccumulator(
    {
      onDraftUpdate: (d) => interruptDrafts.push(d),
      onParagraphCommit: (c) => interruptCommits.push(c)
    },
    2200,
    75
  )
  const spkAInterim = makeUtterance('Are you taking any medication', '1', 1000, 2200, false)
  spkAInterim.language = 'en'
  intAcc.pushInterim(spkAInterim)
  const spkAId = interruptDrafts[interruptDrafts.length - 1].id

  const spkBFinal = makeUtterance('Sí, tomo ibuprofeno cada ocho horas.', '2', 2300, 4100, true)
  spkBFinal.language = 'es'
  intAcc.pushFinalSegment(spkBFinal)
  assert.equal(interruptCommits.length, 1, 'Interim-only Speaker A must commit immediately on Speaker B interruption')
  assert.equal(interruptCommits[0].id, spkAId)
  assert.equal(interruptCommits[0].text, 'Are you taking any medication')
  const spkBId = interruptDrafts[interruptDrafts.length - 1].id
  assert.notEqual(spkBId, spkAId, 'Speaker B must get a fresh turnId so Mini View opens a new stack below Speaker A')
  // Different-language provisional interim must not bleed into Speaker B's Spanish box
  const bleedBefore = interruptDrafts.length
  const bleedInterim = makeUtterance('Okay thank you', '2', 4200, 4600, false)
  bleedInterim.language = 'en'
  intAcc.pushInterim(bleedInterim)
  assert.equal(interruptDrafts.length, bleedBefore, 'Different-language provisional interim must never bleed into active speaker box')
  intAcc.reset()
  console.log('  Mid-frame speaker/lang split + 2.2s pause + clock reset + cross-turn dedup + speechFinal + interim-interruption: VERIFIED')
  console.log('PASS: Test 4 satisfied.\n')

  // TEST 5: Bidirectional Conversation Target Resolution + Gemini Prompt & Governance Audit
  console.log('[TEST 5] Verifying Conversation ES->EN pair resolution, Gemini prompt & Governance...')
  const routingDecision = resolveAudioRoutingPolicy({
    audioRoute: 'system',
    operatingMode: 'conversation',
    sourceLang: 'en',
    targetLang: 'es'
  })
  // Spanish utterance in EN<->ES conversation mode MUST resolve to ES -> EN (never ES -> ES!)
  const esInConvo = resolveTranslationPairForUtterance({
    utteranceLang: 'es-MX',
    channelId: 'channel_b',
    decision: routingDecision,
    operatingMode: 'conversation',
    sourceLang: 'en',
    targetLang: 'es'
  })
  assert.deepEqual(esInConvo, { sourceLang: 'es', targetLang: 'en' })

  const enInConvo = resolveTranslationPairForUtterance({
    utteranceLang: 'en-US',
    channelId: 'channel_b',
    decision: routingDecision,
    operatingMode: 'conversation',
    sourceLang: 'en',
    targetLang: 'es'
  })
  assert.deepEqual(enInConvo, { sourceLang: 'en', targetLang: 'es' })

  const convoPrompt = buildGeminiTranslationPrompt({
    cleanSourceText: '¿Cuándo es mi próxima cita?',
    sourceLang: esInConvo.sourceLang,
    targetLang: esInConvo.targetLang,
    operatingMode: 'conversation',
    historyLines: [],
    glossaryEntries: [['appointment', 'cita']]
  })
  assert.ok(convoPrompt.includes('two-way bilingual conversation between ES and EN'))
  assert.ok(convoPrompt.includes('MANDATORY CUSTOM GLOSSARY'))

  const oneWayPrompt = buildGeminiTranslationPrompt({
    cleanSourceText: 'Your appointment is Tuesday.',
    sourceLang: 'en',
    targetLang: 'es',
    operatingMode: 'translate',
    historyLines: [],
    glossaryEntries: []
  })
  assert.ok(oneWayPrompt.includes('Translate the following utterance from EN to ES'))

  const auditedFiles = [
    'server/src/config.ts',
    'server/src/index.ts',
    'server/src/proxy/deepgramWsProxy.ts',
    'server/src/proxy/geminiStreamProxy.ts',
    'src/renderer/src/audio/stt/GatewaySttClient.ts',
    'src/renderer/src/audio/paragraphAccumulator.ts',
    'src/renderer/src/translation/GatewayTranslationEngine.ts',
    'src/renderer/src/translation/TranslationManager.ts'
  ]
  const emojiRegex = /\p{Extended_Pictographic}/u
  const explicitAnyRegex = /(:\s*any\b|\bas\s+any\b|<any>)/
  for (const rel of auditedFiles) {
    const content = fs.readFileSync(path.resolve(rel), 'utf-8')
    assert.ok(!emojiRegex.test(content), `Emoji detected in ${rel}`)
    assert.ok(!explicitAnyRegex.test(content), `Explicit any detected in ${rel}`)
  }
  console.log('  Gemini two-way prompt + Governance audit (0 emojis, 0 explicit any): VERIFIED')
  console.log('PASS: Test 5 satisfied.\n')

  console.log('==================================================================')
  console.log('DEEPGRAM NOVA-3 + GEMINI PIPELINE AUDIT: 5/5 TESTS PASSED (100%)')
  console.log('==================================================================')
}

run().catch((err) => {
  console.error('DEEPGRAM PIPELINE AUDIT FAILED:', err)
  process.exit(1)
})
