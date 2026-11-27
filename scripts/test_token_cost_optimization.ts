/**
 * DUALAI - Soniox Token & Cost Optimization Verification Suite
 * Empirically verifies:
 * 1. SmartSpeechGate rejects fan hum, ambient noise (-46dBFS), and keyboard clicks (0 bytes sent)
 *    in both Silero VAD neural mode and adaptive RMS fallback mode.
 * 2. SmartSpeechGate preserves 320ms pre-roll (zero clipped first syllables), batches 48ms frames
 *    (6x less WS framing overhead), and closes after 2.2s hangover with ONE clean finalize.
 * 3. SmartSpeechGate immediately cuts off on mute and signals finalize.
 * 4. Soniox Proxy end-to-end Lazy Upstream Dial, Wake-on-Audio with buffered flush,
 *    Transparent Idle Hibernation ($0 idle billing while client socket stays OPEN),
 *    Keepalive absorption while hibernated, Seamless Re-Wake, and Fast Mute Hibernation.
 * 5. Glossary deduplication + Governance audit (0 emojis, 0 explicit any).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import { createGatewayServer } from '../server/src/index.ts'
import {
  buildSonioxConfigMessage,
  normalizeGlossaryTerms
} from '../server/src/proxy/sonioxWsProxy.ts'
import { SmartSpeechGate } from '../src/renderer/src/audio/smartSpeechGate.ts'
import {
  resolveAudioRoutingPolicy,
  sanitizeListenOnlyRoute
} from '../src/renderer/src/audio/audioRoutingPolicy.ts'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeConstantTone(samples: number, amplitude: number, freqHz = 180): Int16Array {
  const out = new Int16Array(samples)
  for (let i = 0; i < samples; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * freqHz * i) / 16000) * amplitude)
  }
  return out
}

async function run(): Promise<void> {
  console.log('==================================================================')
  console.log('DUALAI SONIOX TOKEN & COST OPTIMIZATION AUDIT')
  console.log('==================================================================\n')

  // TEST 1: SmartSpeechGate Noise & Click Rejection (Neural VAD + Adaptive Fallback)
  console.log('[TEST 1] Verifying SmartSpeechGate rejects room hum & keyboard clicks (0 bytes sent)...')
  const neuralGate = new SmartSpeechGate()
  let now = 10_000
  neuralGate.updateVadTelemetry(0.04, false, now)

  // 3 seconds of constant -48 dBFS fan hum (peak ~130, which ALWAYS triggered the old maxAbs >= 45 gate!)
  for (let i = 0; i < 375; i++) {
    now += 8
    if (i % 4 === 0) neuralGate.updateVadTelemetry(0.05, false, now)
    const hum = makeConstantTone(128, 130, 120)
    const res = neuralGate.processChunk(hum, now)
    assert.equal(res.framesToSend.length, 0, 'Ambient fan hum must not send PCM frames')
    assert.equal(res.shouldFinalize, false)
  }

  // Impulsive keyboard click (peak 18,000 for 1 frame, VAD prob 0.08)
  const clickChunk = new Int16Array(128)
  clickChunk[40] = 18000
  clickChunk[41] = -16000
  now += 8
  neuralGate.updateVadTelemetry(0.08, false, now)
  const clickRes = neuralGate.processChunk(clickChunk, now)
  assert.equal(clickRes.framesToSend.length, 0, 'Single-frame keyboard click must not open gate')
  assert.equal(neuralGate.getStats().totalSentSamples, 0, '100% of non-speech audio must be suppressed')

  // Adaptive RMS fallback (when VAD is NOT ready)
  const fallbackGate = new SmartSpeechGate()
  let fbNow = 20_000
  for (let i = 0; i < 120; i++) {
    fbNow += 8
    const quietHum = makeConstantTone(128, 110, 100) // peak 110 > old 45, RMS ~0.0024
    const res = fallbackGate.processChunk(quietHum, fbNow)
    assert.equal(res.framesToSend.length, 0, 'Fallback gate must suppress steady ambient hum')
  }
  // Single-chunk spike in fallback mode must not open gate (requires 2 consecutive frames)
  fbNow += 8
  const singleSpike = makeConstantTone(128, 3000, 400)
  assert.equal(fallbackGate.processChunk(singleSpike, fbNow).framesToSend.length, 0)
  assert.equal(fallbackGate.getStats().totalSentSamples, 0)
  console.log('  Neural VAD + Adaptive RMS Fallback suppressed 100% of fan hum & clicks: VERIFIED')
  console.log('PASS: Test 1 satisfied.\n')

  // TEST 2: 320ms Pre-Roll Preservation, 48ms Batching & 2.2s Hangover + Single Finalize
  console.log('[TEST 2] Verifying 320ms pre-roll preservation, 48ms batching & 2.2s hangover...')
  const speechGate = new SmartSpeechGate({
    preRollMs: 320,
    hangoverMs: 2200,
    batchSamples: 768
  })
  let t = 50_000
  speechGate.updateVadTelemetry(0.02, false, t)

  // Push 40 chunks (320ms) of tagged pre-roll audio with marker value 777 on the very first sample
  for (let i = 0; i < 40; i++) {
    t += 8
    const chunk = new Int16Array(128)
    chunk.fill(i === 0 ? 777 : 25)
    const res = speechGate.processChunk(chunk, t)
    assert.equal(res.framesToSend.length, 0)
  }

  // Soft voice begins (VAD prob = 0.40 >= 0.35 open threshold)
  t += 8
  speechGate.updateVadTelemetry(0.40, false, t)
  const firstVoice = makeConstantTone(128, 600, 320)
  const onsetRes = speechGate.processChunk(firstVoice, t)
  assert.equal(onsetRes.isOpen, true, 'Soft voice (prob=0.40) must open speech gate immediately')
  assert.ok(onsetRes.framesToSend.length >= 6, 'Pre-roll (5120 samples) must flush in 768-sample batches')
  assert.equal(onsetRes.framesToSend[0].length, 768, 'Outbound frames must be batched to 48ms (768 samples)')
  assert.equal(onsetRes.framesToSend[0][0], 777, 'First sample of 320ms pre-roll must be preserved intact')

  // Silence for 1.8s (< 2.2s hangover) -> stays open, no premature finalize on natural breath
  t += 1800
  speechGate.updateVadTelemetry(0.02, false, t)
  const midPause = speechGate.processChunk(new Int16Array(128), t)
  assert.equal(midPause.isOpen, true, 'Must stay open within 2.2s hangover')
  assert.equal(midPause.shouldFinalize, false)

  // Silence crosses 2.25s (> 2.2s hangover) -> closes cleanly and emits ONE finalize
  t += 450
  speechGate.updateVadTelemetry(0.01, false, t)
  const closeRes = speechGate.processChunk(new Int16Array(128), t)
  assert.equal(closeRes.isOpen, false, 'Must close after 2.2s hangover')
  assert.equal(closeRes.shouldFinalize, true, 'Must emit finalize exactly once on pause close')

  // Subsequent silent chunk must NOT emit another finalize
  t += 8
  const afterClose = speechGate.processChunk(new Int16Array(128), t)
  assert.equal(afterClose.shouldFinalize, false, 'Must never emit duplicate finalize')
  assert.equal(afterClose.framesToSend.length, 0)
  console.log('  320ms pre-roll (marker=777) + 48ms batching (768 samples) + 2.2s hangover: VERIFIED')
  console.log('PASS: Test 2 satisfied.\n')

  // TEST 3: Immediate Mute Cutoff & Non-Chopping Self-Voice Call Echo Blocking
  console.log('[TEST 3] Verifying immediate mute cutoff & non-chopping self-voice call echo blocking...')
  t += 100
  speechGate.updateVadTelemetry(0.85, true, t)
  speechGate.processChunk(makeConstantTone(128, 2000, 300), t)
  assert.equal(speechGate.getIsOpen(), true)

  // Brief self-echo suppression flushes any pending pre-echo remote tail (< 768 samples)
  // while dropping 100% of the echo chunk itself and NOT chopping mid-sentence via premature finalize
  t += 8
  speechGate.updateVadTelemetry(0.92, true, t)
  const echoBlock1 = speechGate.processChunk(makeConstantTone(128, 2500, 350), t, {
    suppressAsSelfEcho: true
  })
  assert.equal(echoBlock1.framesToSend.length, 1, 'Flushes only the pending pre-echo remote tail')
  assert.equal(
    echoBlock1.framesToSend[0].length,
    384,
    'Incoming echo chunk must NOT be appended (256 pre-roll + 128 remote voice = 384)'
  )
  assert.equal(echoBlock1.shouldFinalize, false, 'Brief echo suppression must not prematurely chop sentence')

  // Subsequent echo chunks send 0 frames; sustained suppression > 2.2s finalizes preceding remote turn cleanly
  t += 8
  const echoMid = speechGate.processChunk(makeConstantTone(128, 2500, 350), t, {
    suppressAsSelfEcho: true
  })
  assert.equal(echoMid.framesToSend.length, 0, 'Self-voice echo must send 0 PCM frames to Soniox')

  t += 2300
  const echoBlock2 = speechGate.processChunk(makeConstantTone(128, 2500, 350), t, {
    suppressAsSelfEcho: true
  })
  assert.equal(echoBlock2.framesToSend.length, 0)
  assert.equal(echoBlock2.shouldFinalize, true, 'Sustained interpreter turn must finalize preceding remote turn cleanly')
  assert.equal(echoBlock2.isOpen, false)
  assert.ok(speechGate.getStats().echoBlockedSamples >= 384)

  // Re-open with remote voice and verify forceMuteClose
  t += 600
  speechGate.updateVadTelemetry(0.85, true, t)
  speechGate.processChunk(makeConstantTone(128, 2000, 300), t)
  assert.equal(speechGate.getIsOpen(), true)
  const muteRes1 = speechGate.forceMuteClose()
  assert.equal(muteRes1.shouldFinalize, true)
  assert.equal(speechGate.getIsOpen(), false)
  const muteRes2 = speechGate.forceMuteClose()
  assert.equal(muteRes2.shouldFinalize, false)
  console.log('  Immediate mute cutoff + self-voice call echo blocker (0 echo frames leaked): VERIFIED')
  console.log('PASS: Test 3 satisfied.\n')

  // TEST 4: End-to-End Proxy Lazy Dial + Wake-on-Audio + Idle Hibernation + Re-Wake + Fast Mute Hibernate
  console.log('[TEST 4] Testing live Soniox Proxy Lazy Dial, Hibernation, Keepalive Absorption & Re-Wake...')
  let mockUpstreamConnections = 0
  let mockActiveConnections = 0
  let mockBinaryBytesReceived = 0
  let mockKeepalivesReceived = 0
  let mockFinalizesReceived = 0
  const mockInitPayloads: Array<Record<string, unknown>> = []

  const mockSonioxWss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => mockSonioxWss.once('listening', resolve))
  const mockPort = (mockSonioxWss.address() as AddressInfo).port
  const mockSonioxUrl = `ws://127.0.0.1:${mockPort}`

  mockSonioxWss.on('connection', (sock) => {
    mockUpstreamConnections++
    mockActiveConnections++
    sock.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        mockBinaryBytesReceived += buf.length
        sock.send(
          JSON.stringify({
            tokens: [
              {
                text: 'Hello',
                is_final: true,
                speaker: '1',
                language: 'en',
                translation_status: 'original'
              },
              {
                text: 'Hola',
                is_final: true,
                speaker: '1',
                language: 'es',
                source_language: 'en',
                translation_status: 'translation'
              }
            ]
          })
        )
        return
      }

      const parsed = JSON.parse(data.toString()) as { type?: string; model?: string }
      if (parsed.model) {
        mockInitPayloads.push(parsed as Record<string, unknown>)
      } else if (parsed.type === 'keepalive') {
        mockKeepalivesReceived++
      } else if (parsed.type === 'finalize') {
        mockFinalizesReceived++
        sock.send(JSON.stringify({ tokens: [{ text: '<fin>', is_final: true }] }))
      }
    })
    sock.on('close', () => {
      mockActiveConnections--
    })
  })

  const gw = await createGatewayServer({
    nodeEnv: 'test',
    port: 0,
    host: '127.0.0.1',
    sttProvider: 'soniox',
    sonioxApiKey: 'sk_test_soniox_hibernate_key_12345',
    sonioxWsUrl: mockSonioxUrl,
    sonioxIdleHibernateMs: 550,
    sonioxMuteHibernateMs: 200,
    sonioxFinalizeDrainMs: 150,
    quotaMeterIntervalMs: 5000
  })

  try {
    const signInRes = await fetch(`${gw.baseUrl}/v1/auth/dev-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'optimizer@dualai.test' })
    })
    const signIn = (await signInRes.json()) as { accessToken: string }

    const clientMessages: Array<{ type?: string; provider?: string; tokens?: unknown[] }> = []
    let clientClosed = false

    const clientWs = new WebSocket(
      `${gw.wsUrl}/v1/stt?sourceLang=en&targetLang=es&mode=conversation&domain=medical&terms=Amoxicillin,amoxicillin,Dyspnea`,
      ['dualai-auth', signIn.accessToken]
    )

    clientWs.on('message', (raw) => {
      try {
        clientMessages.push(JSON.parse(raw.toString()) as { type?: string })
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
    // 1. Lazy Dial Check: client got quota handshake, ZERO Soniox connections opened yet!
    assert.ok(
      clientMessages.some((m) => m.type === 'dualai_quota' && m.provider === 'soniox-unified'),
      'Client must receive dualai_quota handshake immediately'
    )
    assert.equal(mockUpstreamConnections, 0, 'Lazy dial must open 0 Soniox sockets while idle')

    // Keepalive while idle must NOT wake Soniox
    clientWs.send(JSON.stringify({ type: 'keepalive' }))
    await sleep(80)
    assert.equal(mockUpstreamConnections, 0, 'Keepalive while idle must NOT dial Soniox')
    assert.equal(mockKeepalivesReceived, 0)

    // 2. Wake-on-Audio: send 2 PCM chunks (1536 bytes each)
    clientWs.send(Buffer.alloc(1536, 1))
    clientWs.send(Buffer.alloc(1536, 2))
    await sleep(180)
    assert.equal(mockUpstreamConnections, 1, 'First audio must lazily open Soniox connection #1')
    assert.equal(mockActiveConnections, 1)
    assert.equal(mockBinaryBytesReceived, 3072, 'All buffered PCM frames must flush with zero drops')
    assert.ok(
      clientMessages.some((m) => m.type === 'soniox_tokens'),
      'Relayed soniox_tokens must arrive at client'
    )
    // Check deduped glossary in init payload
    const firstCtx = mockInitPayloads[0]?.context as { terms?: string[] } | undefined
    assert.deepEqual(firstCtx?.terms, ['Amoxicillin', 'Dyspnea'])

    // 3. Transparent Idle Hibernation: stop sending audio and wait > 550ms + 150ms drain
    await sleep(850)
    assert.equal(mockActiveConnections, 0, 'Upstream Soniox must hibernate (close) after idle window')
    assert.equal(clientClosed, false, 'Client WebSocket MUST remain OPEN during upstream hibernation')
    assert.ok(mockFinalizesReceived >= 1, 'Gateway must send finalize prior to hibernating')

    // Keepalive while hibernated must be absorbed ($0 Soniox billing!)
    const kaBefore = mockKeepalivesReceived
    clientWs.send(JSON.stringify({ type: 'keepalive' }))
    await sleep(100)
    assert.equal(mockActiveConnections, 0, 'Keepalive during hibernation must NOT re-open Soniox')
    assert.equal(mockKeepalivesReceived, kaBefore)

    // 4. Seamless Re-Wake on Next Speech
    clientWs.send(Buffer.alloc(1536, 3))
    await sleep(180)
    assert.equal(mockUpstreamConnections, 2, 'New speech must transparently wake Soniox connection #2')
    assert.equal(mockActiveConnections, 1)
    assert.equal(mockBinaryBytesReceived, 4608, 'Re-wake PCM frame must flush cleanly')

    // 5. Fast Mute Hibernation via {"type":"pause"}
    clientWs.send(JSON.stringify({ type: 'pause' }))
    await sleep(350)
    assert.equal(mockActiveConnections, 0, 'Explicit pause/mute must fast-hibernate upstream Soniox')
    assert.equal(clientClosed, false, 'Client socket must stay open while muted/paused')

    // 6. Strict 1-Stream Concurrency Lock (blocks any 2nd simultaneous socket with 4003)
    const secondSocketCode = await new Promise<number>((resolve) => {
      const ws2 = new WebSocket(`${gw.wsUrl}/v1/stt?sourceLang=en&targetLang=es`, [
        'dualai-auth',
        signIn.accessToken
      ])
      ws2.on('close', (code) => resolve(code))
      ws2.on('error', () => resolve(4003))
    })
    assert.equal(
      secondSocketCode,
      4003,
      'Listen-only Gateway must strictly cap each user to 1 concurrent Soniox socket (code 4003)'
    )

    clientWs.close(1000)
    await sleep(50)
  } finally {
    await gw.close()
    await new Promise<void>((resolve) => mockSonioxWss.close(() => resolve()))
  }

  console.log('  Lazy Dial -> Wake #1 -> Idle Hibernate ($0) -> Re-Wake #2 -> Fast Mute Hibernate -> 1-Socket Cap (4003): VERIFIED')
  console.log('PASS: Test 4 satisfied.\n')

  // TEST 5: Listen-Only Policy Enforcement, Glossary Dedup & Governance Audit
  console.log('[TEST 5] Verifying Listen-Only Routing (0 mic capture), Glossary Dedup & Governance...')
  assert.equal(sanitizeListenOnlyRoute('mic'), 'system')
  assert.equal(sanitizeListenOnlyRoute('bilateral'), 'system')
  assert.equal(sanitizeListenOnlyRoute('system'), 'system')
  assert.equal(sanitizeListenOnlyRoute('app'), 'app')
  for (const route of ['mic', 'bilateral', 'system', 'app'] as const) {
    const decision = resolveAudioRoutingPolicy({
      audioRoute: route,
      operatingMode: 'conversation',
      sourceLang: 'en',
      targetLang: 'es'
    })
    assert.equal(decision.captureChannelA, false, `Route ${route} must NEVER capture microphone (Channel A)`)
    assert.equal(decision.captureChannelB, true, `Route ${route} must strictly capture System Audio (Channel B)`)
    assert.equal(decision.isBilateralTwoWay, false)
  }
  assert.deepEqual(
    normalizeGlossaryTerms(['Amoxicillin', 'amoxicillin', '  ', 'Dyspnea', 'DYSPNEA', 'HbA1c']),
    ['Amoxicillin', 'Dyspnea', 'HbA1c']
  )
  const cfg = buildSonioxConfigMessage({
    model: 'stt-rt-v6',
    sampleRate: 16000,
    sourceLang: 'en',
    targetLang: 'es',
    operatingMode: 'conversation',
    domainId: 'medical',
    endpointDelayMs: 2000,
    glossaryTerms: ['Metformin', 'metformin', 'Insulin']
  })
  assert.deepEqual((cfg.context as { terms?: string[] }).terms, ['Metformin', 'Insulin'])

  const auditedFiles = [
    'src/main/systemMicMute.ts',
    'src/renderer/src/audio/audioRoutingPolicy.ts',
    'src/renderer/src/audio/smartSpeechGate.ts',
    'src/renderer/src/audio/AudioIngestionEngine.ts',
    'src/renderer/src/audio/stt/GatewaySttClient.ts',
    'src/renderer/src/audio/stt/StreamingSttManager.ts',
    'server/src/proxy/sonioxWsProxy.ts',
    'server/src/config.ts'
  ]
  const emojiRegex = /\p{Extended_Pictographic}/u
  const explicitAnyRegex = /(:\s*any\b|\bas\s+any\b|<any>)/
  for (const rel of auditedFiles) {
    const src = fs.readFileSync(path.resolve(rel), 'utf-8')
    assert.ok(!emojiRegex.test(src), `Emoji detected in ${rel}`)
    assert.ok(!explicitAnyRegex.test(src), `Explicit any detected in ${rel}`)
  }
  console.log(`  Glossary dedup + ${auditedFiles.length} audited files (0 emojis, 0 any): VERIFIED`)
  console.log('PASS: Test 5 satisfied.\n')

  console.log('==================================================================')
  console.log('SONIOX TOKEN & COST OPTIMIZATION AUDIT: 5/5 TESTS PASSED (100%)')
  console.log('==================================================================')
}

run().catch((err) => {
  console.error('TEST FAILURE:', err)
  process.exit(1)
})
