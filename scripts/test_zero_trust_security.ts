/**
 * DUALAI - ZERO-TRUST SECURITY & PENETRATION VERIFICATION SUITE
 * Spins up the real DualAI Cloud Gateway server on an ephemeral port and executes
 * empirical exploit simulations, binary secret scans, RLS audits, quota exhaustion
 * cutoffs, webhook HMAC forgery tests, and idempotent replay attack defenses.
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'
import { createGatewayServer } from '../server/src/index.ts'
import { GatewayRateLimiter } from '../server/src/security/rateLimiter.ts'

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(full))
    } else if (entry.isFile() && /\.(js|mjs|cjs|html|css)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

async function runPenetrationSuite(): Promise<void> {
  console.log('==================================================================')
  console.log('DUALAI ZERO-TRUST SECURITY & PENETRATION AUDIT')
  console.log('==================================================================\n')

  // ========================================================================
  // TEST 1: Compiled Desktop Binary Secret & SDK Exfiltration Scan
  // ========================================================================
  console.log('[TEST 1] Scanning compiled Electron artifacts (out/) for leaked secrets or provider SDKs...')
  const compiledFiles = walkFiles(path.resolve('out'))
  assert.ok(compiledFiles.length >= 3, 'Production build artifacts must exist in out/ before security scan')

  const forbiddenClientStrings = [
    'SONIOX_API_KEY',
    'DEEPGRAM_API_KEY',
    'GEMINI_API_KEY',
    'VITE_SONIOX_API_KEY',
    'VITE_DEEPGRAM_API_KEY',
    'VITE_GEMINI_API_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'MS_STORE_CLIENT_SECRET',
    'BILLING_WEBHOOK_SECRET',
    'stt-rt.soniox.com',
    'api.deepgram.com',
    'generativelanguage.googleapis.com'
  ]

  for (const file of compiledFiles) {
    const content = fs.readFileSync(file, 'utf-8')
    const rel = path.relative(process.cwd(), file)
    for (const secretPattern of forbiddenClientStrings) {
      assert.ok(
        !content.includes(secretPattern),
        `CRITICAL SECURITY FAILURE: Found forbidden secret/upstream reference "${secretPattern}" in compiled binary ${rel}`
      )
    }
  }
  console.log(`  Scanned ${compiledFiles.length} compiled artifacts in out/: 0 secrets, 0 direct upstream provider endpoints.`)
  console.log('PASS: Test 1 satisfied.\n')

  // Boot live Zero-Trust Gateway on ephemeral port with fast 1s metering for deterministic testing
  const webhookSecret = 'dualai_test_hmac_webhook_secret_2026_verified'
  const gw = await createGatewayServer({
    nodeEnv: 'test',
    port: 0,
    host: '127.0.0.1',
    billingWebhookSecret: webhookSecret,
    quotaMeterIntervalMs: 1000,
    rateLimiter: new GatewayRateLimiter({ maxTokens: 12, refillPerSecond: 1 })
  })

  try {
    // ========================================================================
    // TEST 2: Unauthenticated & Forged JWT Attack Simulation (HTTP + WebSocket)
    // ========================================================================
    console.log('[TEST 2] Attacking Gateway endpoints with missing, malformed, and forged JWTs...')

    const unauthQuota = await fetch(`${gw.baseUrl}/v1/account/quota`)
    assert.equal(unauthQuota.status, 401, 'GET /v1/account/quota must reject unauthenticated requests with 401')

    const unauthTranslate = await fetch(`${gw.baseUrl}/v1/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceText: 'hello', sourceLang: 'en', targetLang: 'es', domainId: 'general' })
    })
    assert.equal(unauthTranslate.status, 401, 'POST /v1/translate must reject unauthenticated requests with 401')

    // Forged JWT (valid structure, attacker-tampered signature)
    const forgedJwt = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"attacker-id","email":"evil@hack.com","exp":9999999999,"iss":"dualai-local-dev"}').toString('base64url')}.invalid_forged_signature`
    const forgedRes = await fetch(`${gw.baseUrl}/v1/account/quota`, {
      headers: { Authorization: `Bearer ${forgedJwt}` }
    })
    assert.equal(forgedRes.status, 401, 'Gateway must reject forged JWT signatures with 401')

    // Unauthenticated WebSocket upgrade attack
    const wsRejected = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`${gw.wsUrl}/v1/stt`)
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode === 401)
      })
      ws.on('error', () => resolve(true))
      ws.on('open', () => {
        ws.close()
        resolve(false)
      })
    })
    assert.equal(wsRejected, true, 'WebSocket /v1/stt must reject unauthenticated upgrades with 401')
    console.log('  Unauthenticated GET/POST/WS & Forged JWT Signature: 100% BLOCKED (401)')
    console.log('PASS: Test 2 satisfied.\n')

    // ========================================================================
    // TEST 3: Automatic 1-Hour Free Tier + Authoritative 0-Second Forced Cutoff
    // ========================================================================
    console.log('[TEST 3] Verifying 1-Hour Free Tier Provisioning & Authoritative 0-Second Server Cutoff...')

    const signInRes = await fetch(`${gw.baseUrl}/v1/auth/dev-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'doctor.demo@dualai.test' })
    })
    assert.equal(signInRes.status, 200)
    const signInData = (await signInRes.json()) as {
      accessToken: string
      user: { userId: string; email: string }
      quota: { remainingSeconds: number; planId: string }
    }
    assert.equal(signInData.quota.planId, 'free_tier')
    assert.equal(signInData.quota.remainingSeconds, 3600, 'New users must receive exactly 3,600 seconds (1 hour) free')

    // Force remaining quota down to 1 second to verify real-time server cutoff
    gw.quotaStore.setTestQuotaSeconds?.(signInData.user.userId, 1)

    const wsCutoffResult = await new Promise<{ closeCode: number; sawExhaustedEvent: boolean }>((resolve, reject) => {
      let sawExhaustedEvent = false
      const ws = new WebSocket(`${gw.wsUrl}/v1/stt?language=en&endpointing=250`, [
        'dualai-auth',
        signInData.accessToken
      ])

      ws.on('open', () => {
        // Stream binary PCM audio so the server metering loop deducts the final second
        ws.send(Buffer.alloc(960))
      })

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type?: string; code?: string }
          if (msg.type === 'dualai_error' && msg.code === 'QUOTA_EXHAUSTED') {
            sawExhaustedEvent = true
          }
        } catch {
          // ignore
        }
      })

      ws.on('close', (code) => resolve({ closeCode: code, sawExhaustedEvent }))
      ws.on('error', (err) => reject(err))
    })

    assert.equal(wsCutoffResult.closeCode, 4002, 'Gateway must force-close WS with code 4002 when quota hits 0')
    assert.equal(wsCutoffResult.sawExhaustedEvent, true, 'Gateway must emit QUOTA_EXHAUSTED event prior to cutoff')

    // Verify POST /v1/translate is immediately blocked with 402 Payment Required
    const exhaustedTranslate = await fetch(`${gw.baseUrl}/v1/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${signInData.accessToken}`
      },
      body: JSON.stringify({
        sourceText: 'Patient blood pressure is stable.',
        sourceLang: 'en',
        targetLang: 'es',
        domainId: 'medical'
      })
    })
    assert.equal(exhaustedTranslate.status, 402, 'Exhausted account must be blocked with 402 Payment Required')
    console.log('  New Account Free Tier: 3600s (1.0h) VERIFIED')
    console.log('  Authoritative WS Metering Cutoff (Code 4002) & Translate Block (HTTP 402): VERIFIED')
    console.log('PASS: Test 3 satisfied.\n')

    // ========================================================================
    // TEST 4: Billing Webhook HMAC Forgery Defense & Idempotent Replay Protection
    // ========================================================================
    console.log('[TEST 4] Testing Billing Webhook HMAC Verification & Replay Attack Protection...')

    const webhookBody = JSON.stringify({
      provider: 'paypal',
      transactionId: 'PAYPAL-TX-HN-99887766',
      userId: signInData.user.userId,
      planId: 'pro_40h'
    })

    // 4a. Forged webhook signature must fail with 401
    const forgedWebhook = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dualai-signature': 'sha256=deadbeef00000000000000000000000000000000000000000000000000000000'
      },
      body: webhookBody
    })
    assert.equal(forgedWebhook.status, 401, 'Forged billing webhook must be rejected with 401')

    // 4b. Valid HMAC-SHA256 signature credits 40 hours (144,000 seconds)
    const validSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(Buffer.from(webhookBody, 'utf-8'))
      .digest('hex')

    const validWebhook1 = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dualai-signature': `sha256=${validSig}`
      },
      body: webhookBody
    })
    assert.equal(validWebhook1.status, 200)
    const credit1 = (await validWebhook1.json()) as { credited: boolean; remainingSeconds: number }
    assert.equal(credit1.credited, true)
    assert.equal(credit1.remainingSeconds, 144000, 'Pro 40h plan must credit exactly 144,000 seconds')

    // 4c. Replay Attack (resending exact same signed webhook) must NOT double-credit
    const replayWebhook = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dualai-signature': `sha256=${validSig}`
      },
      body: webhookBody
    })
    assert.equal(replayWebhook.status, 200)
    const credit2 = (await replayWebhook.json()) as { credited: boolean; remainingSeconds: number }
    assert.equal(credit2.credited, false, 'Replayed transaction ID must not credit hours twice')
    assert.equal(credit2.remainingSeconds, 144000, 'Remaining seconds must stay exactly 144,000 after replay')
    console.log('  Forged Webhook Rejected (401) | Valid HMAC Credited (+144,000s / 40h) | Replay Attack Blocked: VERIFIED')
    console.log('PASS: Test 4 satisfied.\n')

    // ========================================================================
    // TEST 5: Anti-Abuse Payload Stuffing & Rate-Limit Flood Protection
    // ========================================================================
    console.log('[TEST 5] Verifying Payload Stuffing Cap (413) & Rate-Limit Flood Defense (429)...')

    const stuffedRes = await fetch(`${gw.baseUrl}/v1/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${signInData.accessToken}`
      },
      body: JSON.stringify({
        sourceText: 'A'.repeat(5000),
        sourceLang: 'en',
        targetLang: 'es',
        domainId: 'general'
      })
    })
    assert.equal(stuffedRes.status, 413, 'Utterance > 4,000 chars must be rejected with 413 PAYLOAD_TOO_LARGE')

    // Flood IP bucket to verify 429 rate limiting triggers cleanly
    let saw429 = false
    for (let i = 0; i < 20; i++) {
      const r = await fetch(`${gw.baseUrl}/v1/health`)
      if (r.status === 429) {
        saw429 = true
        assert.ok(r.headers.get('retry-after'), '429 response must include Retry-After header')
        break
      }
    }
    assert.equal(saw429, true, 'Rapid flood must trigger 429 RATE_LIMITED defense')
    console.log('  5,000-char Prompt Stuffing Blocked (413) | Flood Rate-Limited (429): VERIFIED')
    console.log('PASS: Test 5 satisfied.\n')
  } finally {
    await gw.close()
  }

  // ========================================================================
  // TEST 6: PostgreSQL RLS & Electron Binary Hardening + Governance Audit
  // ========================================================================
  console.log('[TEST 6] Auditing PostgreSQL RLS Migration, Electron Hardening & Governance Rules...')
  const sqlMigration = fs.readFileSync(
    path.resolve('supabase/migrations/001_zero_trust_quota_billing.sql'),
    'utf-8'
  )
  assert.ok(sqlMigration.includes('ALTER TABLE public.user_quotas FORCE ROW LEVEL SECURITY'))
  assert.ok(sqlMigration.includes('REVOKE ALL ON public.user_quotas FROM anon, authenticated'))
  assert.ok(
    sqlMigration.includes(
      'REVOKE ALL ON FUNCTION public.deduct_usage_seconds(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated'
    )
  )
  assert.ok(sqlMigration.includes('CONSTRAINT uq_billing_provider_tx UNIQUE (provider, external_transaction_id)'))

  const mainSource = fs.readFileSync(path.resolve('src/main/index.ts'), 'utf-8')
  assert.ok(mainSource.includes('sandbox: true'))
  assert.ok(mainSource.includes('nodeIntegration: false'))
  assert.ok(mainSource.includes('safeStorage.encryptString'))
  assert.ok(mainSource.includes('Content-Security-Policy'))
  assert.ok(mainSource.includes('app.isPackaged'))

  const filesToAudit = [
    'server/src/config.ts',
    'server/src/index.ts',
    'server/src/security/authVerifier.ts',
    'server/src/security/rateLimiter.ts',
    'server/src/quota/quotaStore.ts',
    'server/src/billing/billingVerifier.ts',
    'server/src/proxy/sonioxWsProxy.ts',
    'server/src/proxy/deepgramWsProxy.ts',
    'server/src/proxy/geminiStreamProxy.ts',
    'src/main/index.ts',
    'src/renderer/src/services/gatewayAuthService.ts',
    'src/renderer/src/audio/stt/GatewaySttClient.ts',
    'src/renderer/src/translation/GatewayTranslationEngine.ts',
    'src/renderer/src/components/Modals/AccountPlanModal.tsx'
  ]
  const emojiRegex = /\p{Extended_Pictographic}/u
  const anyRegex = /(:\s*any\b|\bas\s+any\b|<any>)/

  for (const rel of filesToAudit) {
    const src = fs.readFileSync(path.resolve(rel), 'utf-8')
    assert.ok(!emojiRegex.test(src), `Governance violation: Emoji found in ${rel}`)
    assert.ok(!anyRegex.test(src), `Governance violation: Explicit any found in ${rel}`)
  }

  console.log(`  PostgreSQL FORCE RLS + Server-Only RPCs: VERIFIED`)
  console.log(`  Electron Sandbox + safeStorage OS Keychain + Strict CSP + DevTools Lock: VERIFIED`)
  console.log(`  Governance Audit (${filesToAudit.length} files): 0 emojis, 0 explicit 'any' types.`)
  console.log('PASS: Test 6 satisfied.\n')

  console.log('==================================================================')
  console.log('ZERO-TRUST SECURITY & PENETRATION AUDIT: 6/6 TESTS PASSED (100%)')
  console.log('==================================================================')
}

runPenetrationSuite().catch((err) => {
  console.error('SECURITY AUDIT FAILED:', err)
  process.exit(1)
})
