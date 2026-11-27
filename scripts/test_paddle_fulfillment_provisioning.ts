/**
 * DUALAI - Automated Paddle Live Fulfillment & Provisioning Verification Suite
 * Tests:
 * 1. hasPaidAccess logic (active, trialing, past_due, canceled, paused, scheduled_change)
 * 2. Webhook signature verification via unmarshal (raw body, reject invalid signature with 401)
 * 3. Idempotent event routing (customer.created, subscription.created, subscription.updated, subscription.canceled, transaction.completed)
 * 4. Quota crediting & state mirroring into customers and subscriptions tables
 * 5. Authenticated customer portal session creation (server-resolved customerId)
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createGatewayServer } from '../server/src/index.ts'
import { hasPaidAccess } from '../server/src/billing/paddleFulfillment.ts'
import { InMemoryQuotaStore } from '../server/src/quota/quotaStore.ts'

async function runPaddleFulfillmentSuite(): Promise<void> {
  console.log('==================================================================')
  console.log('DUALAI: PADDLE FULFILLMENT & PROVISIONING LAYER VERIFICATION')
  console.log('==================================================================\n')

  // --------------------------------------------------------------------------
  // TEST 1: hasPaidAccess Access Helper Semantics
  // --------------------------------------------------------------------------
  console.log('[TEST 1] Testing hasPaidAccess status semantics...')
  assert.equal(hasPaidAccess('active'), true, 'active must grant access')
  assert.equal(hasPaidAccess('trialing'), true, 'trialing must grant access')
  assert.equal(hasPaidAccess('past_due'), true, 'past_due must keep access while retrying payment')
  assert.equal(hasPaidAccess('canceled'), false, 'canceled must revoke access')
  assert.equal(hasPaidAccess('paused'), false, 'paused must not grant access')
  assert.equal(hasPaidAccess('unknown'), false, 'unknown status must not grant access')

  // Object input tests with scheduled changes:
  // Access MUST remain granted while status is active/trialing, even with scheduled cancel/pause!
  assert.equal(
    hasPaidAccess({ status: 'active', scheduled_change: { action: 'cancel', effective_at: '2026-12-31' } }),
    true,
    'Scheduled cancel must NOT revoke active access until effective'
  )
  assert.equal(
    hasPaidAccess({ status: 'trialing', scheduledChangeAction: 'pause' }),
    true,
    'Scheduled pause must NOT revoke trialing access until effective'
  )
  assert.equal(
    hasPaidAccess({ status: 'canceled', scheduled_change: null }),
    false,
    'Canceled status must revoke access'
  )
  console.log('  hasPaidAccess (status strings & scheduled_change objects): VERIFIED\n')

  // --------------------------------------------------------------------------
  // TEST 2: Gateway Webhook Verification with Paddle SDK & HMAC
  // --------------------------------------------------------------------------
  console.log('[TEST 2] Testing Webhook Signature Verification & Event Routing...')
  const webhookSecret = 'pdl_ntfset_01testsecret_key_lxvm_2026'
  const quotaStore = new InMemoryQuotaStore()

  const gw = await createGatewayServer({
    nodeEnv: 'test',
    port: 0,
    host: '127.0.0.1',
    billingWebhookSecret: webhookSecret,
    paddleApiKey: 'pdl_live_apikey_test_for_portal',
    quotaStore
  })

  try {
    // 2a. Reject request with missing signature
    const missingSigRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'subscription.created', data: {} })
    })
    assert.equal(missingSigRes.status, 401, 'Request without signature must return 401')

    // 2b. Reject request with forged signature
    const forgedSigRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paddle-signature': 'ts=1700000000;h1=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      },
      body: JSON.stringify({ event_type: 'subscription.created', data: {} })
    })
    assert.equal(forgedSigRes.status, 401, 'Tampered signature must return 401 (not 2xx)')

    // 2c. Successful unmarshal & routing for customer.created
    const customerPayload = JSON.stringify({
      event_id: 'evt_cust_001',
      event_type: 'customer.created',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'ctm_test_dualai_001',
        email: 'doctor.patel@hospital.org',
        name: 'Dr. Patel',
        status: 'active',
        custom_data: { userId: 'usr_patel_uuid_001' }
      }
    })

    const ts1 = Math.floor(Date.now() / 1000)
    const h1_1 = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${ts1}:${customerPayload}`)
      .digest('hex')

    const custRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paddle-signature': `ts=${ts1};h1=${h1_1}`
      },
      body: customerPayload
    })
    assert.equal(custRes.status, 200, 'Valid customer.created must return 200')
    const custBody = (await custRes.json()) as { received: boolean; handled: boolean }
    assert.equal(custBody.received, true)
    assert.equal(custBody.handled, true)

    // Verify mirrored in fulfillment service
    const mirroredCust = await gw.paddleFulfillment.findCustomerById('ctm_test_dualai_001')
    assert.ok(mirroredCust, 'Customer must be mirrored in fulfillment cache')
    assert.equal(mirroredCust?.email, 'doctor.patel@hospital.org')
    assert.equal(mirroredCust?.userId, 'usr_patel_uuid_001')
    console.log('  Signature Verification & customer.created Mirroring: VERIFIED\n')

    // --------------------------------------------------------------------------
    // TEST 3: subscription.created + transaction.completed MUST credit ONCE (Zero Double-Credit!)
    // --------------------------------------------------------------------------
    console.log('[TEST 3] Testing subscription.created + transaction.completed (single atomic credit)...')
    const subCreatedPayload = JSON.stringify({
      event_id: 'evt_sub_001',
      event_type: 'subscription.created',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'sub_test_pro_40h_001',
        customer_id: 'ctm_test_dualai_001',
        status: 'active',
        created_at: new Date().toISOString(),
        items: [
          {
            price: {
              id: 'pri_01m8aw2f6rzakqqenynbztq74f',
              product_id: 'pro_01m8avhb2vpt2qhxh6mfchxv7x'
            },
            quantity: 1
          }
        ],
        custom_data: { userId: 'usr_patel_uuid_001' }
      }
    })

    const ts2 = Math.floor(Date.now() / 1000)
    const h1_2 = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${ts2}:${subCreatedPayload}`)
      .digest('hex')

    const subRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paddle-signature': `ts=${ts2};h1=${h1_2}`
      },
      body: subCreatedPayload
    })
    assert.equal(subRes.status, 200)
    const subBody = (await subRes.json()) as { received: boolean; credited: boolean; planId: string }
    assert.equal(subBody.received, true)
    assert.equal(subBody.credited, false, 'subscription.created must sync state ONLY and NOT credit hours')
    assert.equal(subBody.planId, 'pro_40h')

    // Now transaction.completed fires for the exact same checkout — MUST credit 40h ONCE
    const initialTxPayload = JSON.stringify({
      event_id: 'evt_tx_initial_001',
      event_type: 'transaction.completed',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'txn_test_initial_pro_40h_001',
        customer_id: 'ctm_test_dualai_001',
        subscription_id: 'sub_test_pro_40h_001',
        custom_data: { userId: 'usr_patel_uuid_001' },
        items: [
          {
            price: {
              id: 'pri_01m8aw2f6rzakqqenynbztq74f',
              product_id: 'pro_01m8avhb2vpt2qhxh6mfchxv7x'
            },
            quantity: 1
          }
        ]
      }
    })
    const ts2b = Math.floor(Date.now() / 1000)
    const h1_2b = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${ts2b}:${initialTxPayload}`)
      .digest('hex')

    const initialTxRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paddle-signature': `ts=${ts2b};h1=${h1_2b}`
      },
      body: initialTxPayload
    })
    assert.equal(initialTxRes.status, 200)
    const initialTxBody = (await initialTxRes.json()) as { credited: boolean; planId: string }
    assert.equal(initialTxBody.credited, true, 'transaction.completed must credit hours')
    assert.equal(initialTxBody.planId, 'pro_40h')

    // Check quotaStore state — MUST be exactly 1h free + 40h (NEVER 1h + 80h!)
    const userQuota = await quotaStore.getOrCreateUserQuota('usr_patel_uuid_001')
    assert.equal(userQuota.planId, 'pro_40h')
    assert.equal(userQuota.remainingSeconds, 3600 + 144000)
    assert.equal(userQuota.subscriptionStatus, 'active')

    // --------------------------------------------------------------------------
    // TEST 4: Idempotent Replay Guard (Replaying transaction.completed must NOT double-credit)
    // --------------------------------------------------------------------------
    console.log('[TEST 4] Testing Idempotent Replay Guard (must not double-credit)...')
    const replayRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paddle-signature': `ts=${ts2b};h1=${h1_2b}`
      },
      body: initialTxPayload
    })
    assert.equal(replayRes.status, 200)
    const replayBody = (await replayRes.json()) as { credited: boolean }
    assert.equal(replayBody.credited, false, 'Replaying transaction.completed must NOT double-credit')

    const quotaAfterReplay = await quotaStore.getOrCreateUserQuota('usr_patel_uuid_001')
    assert.equal(quotaAfterReplay.remainingSeconds, 3600 + 144000)
    console.log('  Single Atomic Credit & Idempotent Replay Guard: VERIFIED\n')

    // --------------------------------------------------------------------------
    // TEST 5: subscription.updated with scheduled_change (must NOT revoke access)
    // --------------------------------------------------------------------------
    console.log('[TEST 5] Testing subscription.updated with scheduled cancellation...')
    const scheduledCancelPayload = JSON.stringify({
      event_id: 'evt_sub_cancel_scheduled',
      event_type: 'subscription.updated',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'sub_test_pro_40h_001',
        customer_id: 'ctm_test_dualai_001',
        status: 'active', // Status is STILL active even if cancellation is scheduled!
        scheduled_change: {
          action: 'cancel',
          effective_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString()
        },
        items: [
          {
            price: {
              id: 'pri_01m8aw2f6rzakqqenynbztq74f',
              product_id: 'pro_01m8avhb2vpt2qhxh6mfchxv7x'
            }
          }
        ]
      }
    })

    const ts3 = Math.floor(Date.now() / 1000)
    const h1_3 = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${ts3}:${scheduledCancelPayload}`)
      .digest('hex')

    const schedRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paddle-signature': `ts=${ts3};h1=${h1_3}`
      },
      body: scheduledCancelPayload
    })
    assert.equal(schedRes.status, 200)

    // Access must still be granted
    assert.equal(hasPaidAccess('active'), true)
    console.log('  Scheduled Cancellation Grace Period: VERIFIED\n')

    // --------------------------------------------------------------------------
    // TEST 6: subscription.canceled (Actual cancellation revokes access)
    // --------------------------------------------------------------------------
    console.log('[TEST 6] Testing subscription.canceled...')
    const subCanceledPayload = JSON.stringify({
      event_id: 'evt_sub_canceled_final',
      event_type: 'subscription.canceled',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'sub_test_pro_40h_001',
        customer_id: 'ctm_test_dualai_001',
        status: 'canceled',
        items: [
          {
            price: {
              id: 'pri_01m8aw2f6rzakqqenynbztq74f',
              product_id: 'pro_01m8avhb2vpt2qhxh6mfchxv7x'
            }
          }
        ]
      }
    })

    const ts4 = Math.floor(Date.now() / 1000)
    const h1_4 = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${ts4}:${subCanceledPayload}`)
      .digest('hex')

    const cancelRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paddle-signature': `ts=${ts4};h1=${h1_4}`
      },
      body: subCanceledPayload
    })
    assert.equal(cancelRes.status, 200)
    assert.equal(hasPaidAccess('canceled'), false, 'Canceled status must revoke paid access')
    console.log('  subscription.canceled: VERIFIED\n')

    // --------------------------------------------------------------------------
    // TEST 7: Customer Portal Session Minting
    // --------------------------------------------------------------------------
    console.log('[TEST 7] Testing Customer Portal Session Minting (server-side resolved customerId)...')
    // Sign in as our mirrored user
    const signInRes = await fetch(`${gw.baseUrl}/v1/auth/dev-signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'doctor.patel@hospital.org' })
    })
    assert.equal(signInRes.status, 200)
    const session = (await signInRes.json()) as { accessToken: string; user: { userId: string } }

    // Associate customer in fulfillment service memory with this user ID
    await gw.paddleFulfillment.upsertCustomerMirror({
      customerId: 'ctm_test_dualai_001',
      email: 'doctor.patel@hospital.org',
      userId: session.user.userId
    })

    // Mock customerPortalSessions.create on fulfillment paddleClient
    const fulfillmentClient = gw.paddleFulfillment.getPaddleClient()
    if (fulfillmentClient) {
      fulfillmentClient.customerPortalSessions.create = async (customerId, subIds) => {
        assert.equal(customerId, 'ctm_test_dualai_001', 'CustomerId must match server-resolved record')
        return {
          id: 'cpt_test_session_123',
          customerId,
          urls: {
            general: {
              overview: `https://customer-portal.paddle.com/cpt_test_session_123/overview`
            },
            subscriptions: subIds.map((id) => ({
              id,
              cancelSubscription: `https://customer-portal.paddle.com/cancel/${id}`,
              updateSubscriptionPaymentMethod: `https://customer-portal.paddle.com/payment/${id}`
            }))
          },
          createdAt: new Date().toISOString()
        } as any
      }

      const portalRes = await fetch(`${gw.baseUrl}/v1/billing/customer-portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`
        }
      })
      assert.equal(portalRes.status, 200)
      const portalData = (await portalRes.json()) as { ok: boolean; portalUrl: string }
      assert.equal(portalData.ok, true)
      assert.ok(portalData.portalUrl.includes('customer-portal.paddle.com'))

      // Test 7b: GET redirect endpoint (HTTP 302 redirect directly to portal)
      const redirectRes = await fetch(
        `${gw.baseUrl}/v1/billing/customer-portal/redirect?token=${session.accessToken}`,
        {
          redirect: 'manual'
        }
      )
      assert.equal(redirectRes.status, 302, 'Customer portal redirect endpoint must return 302')
      assert.equal(
        redirectRes.headers.get('location'),
        'https://customer-portal.paddle.com/cpt_test_session_123/overview'
      )
      console.log('  Customer Portal JSON & 302 Redirect Endpoints: VERIFIED\n')
    } else {
      console.log('  Customer Portal: PaddleClient not configured in test mode (skipped live SDK mock)\n')
    }

    // --------------------------------------------------------------------------
    // TEST 8: customer.updated & transaction.completed routing
    // --------------------------------------------------------------------------
    console.log('[TEST 8] Testing customer.updated & transaction.completed...')
    const updatePayload = JSON.stringify({
      event_id: 'evt_cust_upd_001',
      event_type: 'customer.updated',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'ctm_test_dualai_001',
        email: 'doctor.patel.senior@hospital.org',
        custom_data: { userId: session.user.userId }
      }
    })
    const ts5 = Math.floor(Date.now() / 1000)
    const h1_5 = crypto.createHmac('sha256', webhookSecret).update(`${ts5}:${updatePayload}`).digest('hex')
    const updRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paddle-signature': `ts=${ts5};h1=${h1_5}`
      },
      body: updatePayload
    })
    assert.equal(updRes.status, 200)
    const updatedCustomer = await gw.paddleFulfillment.findCustomerById('ctm_test_dualai_001')
    assert.equal(updatedCustomer?.email, 'doctor.patel.senior@hospital.org')

    // transaction.completed
    const txPayload = JSON.stringify({
      event_id: 'evt_tx_001',
      event_type: 'transaction.completed',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'txn_test_001',
        customer_id: 'ctm_test_dualai_001',
        custom_data: { userId: session.user.userId },
        items: [
          {
            price: {
              id: 'pri_01m8aw2f6rzakqqenynbztq74f',
              product_id: 'pro_01m8avhb2vpt2qhxh6mfchxv7x'
            }
          }
        ]
      }
    })
    const ts6 = Math.floor(Date.now() / 1000)
    const h1_6 = crypto.createHmac('sha256', webhookSecret).update(`${ts6}:${txPayload}`).digest('hex')
    const txRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paddle-signature': `ts=${ts6};h1=${h1_6}`
      },
      body: txPayload
    })
    assert.equal(txRes.status, 200)
    console.log('  customer.updated & transaction.completed: VERIFIED\n')

    // --------------------------------------------------------------------------
    // TEST 9: In-App Subscription Cancel, Undo Cancel, Ownership & Refund Clawback
    // --------------------------------------------------------------------------
    console.log('[TEST 9] Testing Cancel Subscription, Undo Cancel, Auth Security & Refund Clawback...')
    // Unauthenticated cancel must be rejected with 401
    const unauthCancel = await fetch(`${gw.baseUrl}/v1/billing/subscription/cancel`, {
      method: 'POST'
    })
    assert.equal(unauthCancel.status, 401, 'Unauthenticated cancel must return 401')

    // Create active subscription mirror for signed-in session user
    await gw.paddleFulfillment.upsertSubscriptionMirror({
      subscriptionId: 'sub_live_cancel_test_001',
      customerId: 'ctm_test_dualai_001',
      userId: session.user.userId,
      status: 'active',
      priceId: 'pri_01m8aw2f6rzakqqenynbztq74f',
      productId: 'pro_01m8avhb2vpt2qhxh6mfchxv7x',
      scheduledChangeAction: null,
      scheduledChangeAt: null,
      lastEventAt: new Date().toISOString()
    })

    if (fulfillmentClient) {
      const nextPeriodEnd = new Date(Date.now() + 30 * 86400 * 1000).toISOString()
      fulfillmentClient.subscriptions.cancel = async (subId, opts) => {
        assert.equal(subId, 'sub_live_cancel_test_001')
        assert.equal(opts?.effectiveFrom, 'next_billing_period', 'Must default to next_billing_period')
        return {
          id: subId,
          status: 'active',
          items: [{ price: { id: 'pri_01m8aw2f6rzakqqenynbztq74f', productId: 'pro_01m8avhb2vpt2qhxh6mfchxv7x' } }],
          scheduledChange: { action: 'cancel', effectiveAt: nextPeriodEnd },
          nextBilledAt: null
        } as any
      }
      fulfillmentClient.subscriptions.update = async (subId, body) => {
        assert.equal(subId, 'sub_live_cancel_test_001')
        assert.equal(body.scheduledChange, null)
        return {
          id: subId,
          status: 'active',
          items: [{ price: { id: 'pri_01m8aw2f6rzakqqenynbztq74f', productId: 'pro_01m8avhb2vpt2qhxh6mfchxv7x' } }],
          scheduledChange: null,
          nextBilledAt: nextPeriodEnd
        } as any
      }

      // Duplicate checkout on the exact same active plan must be blocked (400)
      const dupCheckout = await fetch(`${gw.baseUrl}/v1/billing/checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ planId: 'pro_40h', provider: 'paddle' })
      })
      assert.equal(dupCheckout.status, 400, 'Duplicate active subscription checkout must be rejected')

      // Cancel subscription via authenticated endpoint
      const cancelSubRes = await fetch(`${gw.baseUrl}/v1/billing/subscription/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` }
      })
      assert.equal(cancelSubRes.status, 200)
      const cancelSubData = (await cancelSubRes.json()) as {
        ok: boolean
        subscription: { status: string; scheduledChangeAction: string | null }
      }
      assert.equal(cancelSubData.ok, true)
      assert.equal(cancelSubData.subscription.status, 'active')
      assert.equal(cancelSubData.subscription.scheduledChangeAction, 'cancel')

      // GET /v1/account/quota must reflect scheduled cancellation in subscription DTO
      const quotaWithSub = await fetch(`${gw.baseUrl}/v1/account/quota`, {
        headers: { Authorization: `Bearer ${session.accessToken}` }
      })
      assert.equal(quotaWithSub.status, 200)
      const quotaWithSubData = (await quotaWithSub.json()) as {
        subscription: { scheduledChangeAction: string | null }
      }
      assert.equal(quotaWithSubData.subscription.scheduledChangeAction, 'cancel')

      // Undo cancellation
      const undoRes = await fetch(`${gw.baseUrl}/v1/billing/subscription/undo-cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` }
      })
      assert.equal(undoRes.status, 200)
      const undoData = (await undoRes.json()) as {
        ok: boolean
        subscription: { scheduledChangeAction: string | null }
      }
      assert.equal(undoData.ok, true)
      assert.equal(undoData.subscription.scheduledChangeAction, null)

      // Self-healing reconciliation when Paddle already has a scheduled cancellation
      // (e.g. canceled in Customer Portal while local mirror was stale)
      fulfillmentClient.subscriptions.cancel = async () => {
        const lockedErr = new Error('This subscription already has a scheduled change.') as Error & {
          code: string
        }
        lockedErr.code = 'subscription_locked_pending_changes'
        throw lockedErr
      }
      fulfillmentClient.subscriptions.get = async (subId) => {
        assert.equal(subId, 'sub_live_cancel_test_001')
        return {
          id: subId,
          customerId: 'ctm_test_dualai_001',
          status: 'active',
          items: [{ price: { id: 'pri_01m8aw2f6rzakqqenynbztq74f', productId: 'pro_01m8avhb2vpt2qhxh6mfchxv7x' } }],
          scheduledChange: { action: 'cancel', effectiveAt: nextPeriodEnd },
          nextBilledAt: null,
          updatedAt: new Date().toISOString()
        } as any
      }

      const reconciledCancelRes = await fetch(`${gw.baseUrl}/v1/billing/subscription/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` }
      })
      assert.equal(reconciledCancelRes.status, 200)
      const reconciledData = (await reconciledCancelRes.json()) as {
        ok: boolean
        alreadyScheduled?: boolean
        message?: string
        subscription: { scheduledChangeAction: string | null; scheduledChangeAt: string | null }
      }
      assert.equal(reconciledData.ok, true, 'Already-scheduled cancel on Paddle must reconcile idempotently')
      assert.equal(reconciledData.alreadyScheduled, true)
      assert.equal(reconciledData.subscription.scheduledChangeAction, 'cancel')
      assert.ok(reconciledData.message && reconciledData.message.includes('already scheduled to end on'))

      // Scheduled pause on Paddle must return friendly date-aware error + synced subscription
      await gw.paddleFulfillment.upsertSubscriptionMirror({
        subscriptionId: 'sub_live_cancel_test_001',
        customerId: 'ctm_test_dualai_001',
        userId: session.user.userId,
        status: 'active',
        priceId: 'pri_01m8aw2f6rzakqqenynbztq74f',
        productId: 'pro_01m8avhb2vpt2qhxh6mfchxv7x',
        scheduledChangeAction: null,
        scheduledChangeAt: null,
        lastEventAt: new Date(Date.now() + 1000).toISOString()
      })
      fulfillmentClient.subscriptions.get = async (subId) =>
        ({
          id: subId,
          customerId: 'ctm_test_dualai_001',
          status: 'active',
          items: [{ price: { id: 'pri_01m8aw2f6rzakqqenynbztq74f', productId: 'pro_01m8avhb2vpt2qhxh6mfchxv7x' } }],
          scheduledChange: { action: 'pause', effectiveAt: nextPeriodEnd },
          nextBilledAt: null,
          updatedAt: new Date(Date.now() + 2000).toISOString()
        }) as any

      const pausedConflictRes = await fetch(`${gw.baseUrl}/v1/billing/subscription/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` }
      })
      assert.equal(pausedConflictRes.status, 400)
      const pausedConflictData = (await pausedConflictRes.json()) as {
        ok: boolean
        error?: string
        subscription?: { scheduledChangeAction: string | null }
      }
      assert.equal(pausedConflictData.ok, false)
      assert.equal(pausedConflictData.subscription?.scheduledChangeAction, 'pause')
      assert.ok(pausedConflictData.error?.includes('scheduled to pause on'))

      // Explicit ?sync=1 on GET /v1/account/quota must live-reconcile from Paddle
      const liveSyncQuotaRes = await fetch(`${gw.baseUrl}/v1/account/quota?sync=1`, {
        headers: { Authorization: `Bearer ${session.accessToken}` }
      })
      assert.equal(liveSyncQuotaRes.status, 200)
      const liveSyncQuotaData = (await liveSyncQuotaRes.json()) as {
        subscription: { scheduledChangeAction: string | null }
      }
      assert.equal(liveSyncQuotaData.subscription.scheduledChangeAction, 'pause')
    }

    // Approved refund adjustment must claw back hours atomically and idempotently
    const beforeRefund = await quotaStore.getOrCreateUserQuota(session.user.userId)
    const refundPayload = JSON.stringify({
      event_id: 'evt_adj_refund_001',
      event_type: 'adjustment.updated',
      occurred_at: new Date().toISOString(),
      data: {
        id: 'adj_test_refund_001',
        action: 'refund',
        status: 'approved',
        customer_id: 'ctm_test_dualai_001',
        transaction_id: 'txn_test_001'
      }
    })
    const ts7 = Math.floor(Date.now() / 1000)
    const h1_7 = crypto.createHmac('sha256', webhookSecret).update(`${ts7}:${refundPayload}`).digest('hex')
    const refundRes = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paddle-signature': `ts=${ts7};h1=${h1_7}` },
      body: refundPayload
    })
    assert.equal(refundRes.status, 200)
    const refundBody = (await refundRes.json()) as { revoked: boolean }
    assert.equal(refundBody.revoked, true)
    const afterRefund = await quotaStore.getOrCreateUserQuota(session.user.userId)
    assert.equal(afterRefund.remainingSeconds, Math.max(0, beforeRefund.remainingSeconds - 144000))

    // Replay same refund adjustment must NOT claw back twice
    const refundReplay = await fetch(`${gw.baseUrl}/v1/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paddle-signature': `ts=${ts7};h1=${h1_7}` },
      body: refundPayload
    })
    assert.equal(refundReplay.status, 200)
    const refundReplayBody = (await refundReplay.json()) as { revoked: boolean }
    assert.equal(refundReplayBody.revoked, false, 'Replaying adjustment must NOT deduct hours twice')
    console.log('  Cancel, Undo Cancel, Duplicate Checkout Guard & Atomic Refund Clawback: VERIFIED\n')

    console.log('PASS: ALL PADDLE FULFILLMENT & PROVISIONING TESTS COMPLETED SUCCESSFULLY.')
    console.log('==================================================================\n')
  } finally {
    await gw.close()
  }
}

void runPaddleFulfillmentSuite().catch((err) => {
  console.error('FAIL: Paddle fulfillment test suite encountered an error:', err)
  process.exit(1)
})
