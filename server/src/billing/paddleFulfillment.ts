/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Paddle Billing Fulfillment & Provisioning Layer
 * Full server-side fulfillment supporting:
 * 1. Webhook signature verification via @paddle/paddle-node-sdk unmarshal
 * 2. Idempotent state mirroring into customers and subscriptions tables
 * 3. Authoritative access granting & plan entitlement helper
 * 4. Customer Portal session generation via Paddle Node SDK
 */

import crypto from 'node:crypto'
import {
  ApiError,
  Environment,
  LogLevel,
  Paddle,
  EventName,
  type EventEntity,
  type CustomerCreatedEvent,
  type CustomerUpdatedEvent,
  type SubscriptionCreatedEvent,
  type SubscriptionUpdatedEvent,
  type SubscriptionCanceledEvent,
  type TransactionCompletedEvent
} from '@paddle/paddle-node-sdk'
import { GatewayConfig } from '../config.js'
import {
  PLAN_CATALOG,
  PlanId,
  QuotaStore,
  findPlanByPaddlePriceId,
  findPlanByPaddleProductId
} from '../quota/quotaStore.js'

export interface MirroredCustomer {
  customerId: string
  email: string
  userId?: string | null
  lastEventAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface MirroredSubscription {
  subscriptionId: string
  customerId: string
  userId?: string | null
  status: string
  subscriptionStatus?: string
  priceId: string
  productId: string
  scheduledChangeAction?: string | null
  scheduledChangeAt?: string | null
  paddleCreatedAt?: string | null
  lastEventAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AccountSubscriptionSummary {
  subscriptionId: string
  planId: PlanId
  status: 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled'
  scheduledChangeAction: 'cancel' | 'pause' | 'resume' | null
  scheduledChangeAt: string | null
  nextBilledAt: string | null
}

export interface FulfillmentEventResult {
  handled: boolean
  eventType: string
  resourceId?: string
  userId?: string
  planId?: string
  credited?: boolean
  revoked?: boolean
  error?: string
}

export interface SubscriptionAccessInput {
  status: string
  scheduledChangeAction?: string | null
  scheduledChangeAt?: string | null
  scheduled_change?: { action?: string; effective_at?: string } | null
}

/**
 * Access helper: Decides whether a subscription currently grants paid access.
 * - Treat 'active' AND 'trialing' as access-granting.
 * - Do NOT revoke access just because a scheduled_change to cancel or pause exists:
 *   access MUST remain granted until status is actually 'canceled' or 'paused'.
 * - 'past_due' retains access during collection retry / grace period (per SaaS rules).
 * - 'canceled' and 'paused' do NOT grant paid access.
 */
export function hasPaidAccess(
  statusOrSubscription: string | SubscriptionAccessInput,
  options?: { allowPastDue?: boolean }
): boolean {
  const allowPastDue = options?.allowPastDue ?? true
  const status =
    typeof statusOrSubscription === 'string'
      ? statusOrSubscription
      : statusOrSubscription?.status
  const normalized = (status || '').toLowerCase().trim()

  // 1. active AND trialing grant paid access
  if (normalized === 'active' || normalized === 'trialing') {
    return true
  }

  // 2. past_due grace period while Paddle retries collection
  if (normalized === 'past_due') {
    return allowPastDue
  }

  // 3. canceled and paused revoke access
  if (normalized === 'canceled' || normalized === 'paused') {
    return false
  }

  return false
}

export class PaddleFulfillmentService {
  private config: GatewayConfig
  private quotaStore: QuotaStore
  private paddleClient: Paddle | null = null

  // Fast resilient in-memory mirror cache
  private memoryCustomers: Map<string, MirroredCustomer> = new Map()
  private memorySubscriptions: Map<string, MirroredSubscription> = new Map()

  constructor(config: GatewayConfig, quotaStore: QuotaStore) {
    this.config = config
    this.quotaStore = quotaStore

    if (config.paddleApiKey) {
      this.paddleClient = new Paddle(config.paddleApiKey, {
        environment:
          config.paddleEnvironment === 'sandbox' ? Environment.sandbox : Environment.production,
        logLevel: config.nodeEnv === 'production' ? LogLevel.error : LogLevel.warn
      })
    }
  }

  public getPaddleClient(): Paddle | null {
    return this.paddleClient
  }

  /**
   * Verifies and unmarshals raw Paddle webhook payload using Paddle Node SDK.
   * Throws if signature is invalid, payload is malformed, or secret is misconfigured.
   */
  public async unmarshalWebhook(
    rawBody: string,
    signatureHeader: string
  ): Promise<EventEntity> {
    const webhookSecret =
      this.config.billingWebhookSecret ||
      process.env.PADDLE_NOTIFICATION_WEBHOOK_SECRET ||
      process.env.BILLING_WEBHOOK_SECRET ||
      ''

    if (!webhookSecret) {
      throw new Error(
        '[Paddle] Webhook signing secret (PADDLE_NOTIFICATION_WEBHOOK_SECRET / BILLING_WEBHOOK_SECRET) is not configured.'
      )
    }

    // Safety guard: API key and webhook notification signing secret are different!
    if (
      webhookSecret.startsWith('pdl_live_apikey_') ||
      webhookSecret.startsWith('pdl_sdbx_apikey_')
    ) {
      throw new Error(
        '[Paddle] Misconfiguration detected: You configured a Paddle API key as the webhook secret. ' +
        'Paddle webhooks must be verified using the notification destination endpoint secret (pdl_ntfset_...), NOT the API key.'
      )
    }

    const paddleInstance =
      this.paddleClient ||
      new Paddle('pdl_live_apikey_dummy_for_unmarshal', {
        environment:
          this.config.paddleEnvironment === 'sandbox' ? Environment.sandbox : Environment.production,
        logLevel: LogLevel.error
      })

    try {
      return await paddleInstance.webhooks.unmarshal(
        rawBody,
        webhookSecret,
        signatureHeader
      )
    } catch {
      // Fallback check if signature itself is cryptographically valid
      const isSignatureValid = this.verifyPaddleSignature(
        rawBody,
        signatureHeader,
        webhookSecret
      )
      if (!isSignatureValid) {
        throw new Error('[Paddle] Webhook signature verification failed')
      }

      // If signature is authentic but SDK model threw an internal parsing issue (e.g. missing nested field)
      const parsed = JSON.parse(rawBody) as Record<string, unknown>
      return {
        eventId: String(parsed.event_id || `evt_${Date.now()}`),
        eventType: String(parsed.event_type || '') as EventName,
        occurredAt: String(parsed.occurred_at || new Date().toISOString()),
        data: (parsed.data || {}) as any,
        notificationId: String(parsed.notification_id || '')
      } as unknown as EventEntity
    }
  }

  private verifyPaddleSignature(
    rawBody: string,
    signatureHeader: string,
    secretKey: string
  ): boolean {
    const parts = signatureHeader.split(';').reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split('=')
      if (k && v) acc[k.trim()] = v.trim()
      return acc
    }, {})

    const ts = parts['ts']
    const h1 = parts['h1']
    if (!ts || !h1) return false

    // Replay-attack freshness guard (5-minute tolerance in non-test environments)
    if (this.config.nodeEnv !== 'test') {
      const tsNum = Number(ts)
      const nowSec = Math.floor(Date.now() / 1000)
      if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > 300) {
        return false
      }
    }

    const payloadToSign = `${ts}:${rawBody}`
    const expectedH1 = crypto
      .createHmac('sha256', secretKey)
      .update(payloadToSign)
      .digest('hex')

    const providedBuf = Buffer.from(h1, 'utf-8')
    const expectedBuf = Buffer.from(expectedH1, 'utf-8')
    return (
      providedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(providedBuf, expectedBuf)
    )
  }

  /**
   * Routes verified Paddle events to typed idempotent handlers.
   * Safe to call multiple times with out-of-order retries.
   */
  public async processVerifiedEvent(event: EventEntity): Promise<FulfillmentEventResult> {
    switch (event.eventType) {
      case EventName.CustomerCreated:
        return this.handleCustomerCreated(event as CustomerCreatedEvent)

      case EventName.CustomerUpdated:
        return this.handleCustomerUpdated(event as CustomerUpdatedEvent)

      case EventName.SubscriptionCreated:
        return this.handleSubscriptionCreated(event as SubscriptionCreatedEvent)

      case EventName.SubscriptionUpdated:
        return this.handleSubscriptionUpdated(event as SubscriptionUpdatedEvent)

      case EventName.SubscriptionCanceled:
        return this.handleSubscriptionCanceled(event as SubscriptionCanceledEvent)

      case EventName.TransactionCompleted:
        return this.handleTransactionCompleted(event as TransactionCompletedEvent)

      case EventName.AdjustmentCreated:
      case EventName.AdjustmentUpdated:
        return this.handleAdjustmentEvent(event)

      default:
        return {
          handled: true,
          eventType: event.eventType,
          resourceId: (event.data as { id?: string })?.id
        }
    }
  }

  // ==========================================================================
  // Typed Event Handlers
  // ==========================================================================

  private async handleCustomerCreated(
    event: CustomerCreatedEvent
  ): Promise<FulfillmentEventResult> {
    const data = event.data as any
    const customerId = data.id
    const email = data.email
    const customData = (data.customData || data.custom_data || {}) as Record<string, unknown>
    const userId = (customData.userId || customData.user_id || null) as string | null
    const occurredAt = event.occurredAt || (event as any).occurred_at

    await this.upsertCustomerMirror({
      customerId,
      email,
      userId,
      lastEventAt: occurredAt
    })

    return {
      handled: true,
      eventType: event.eventType,
      resourceId: customerId,
      userId: userId || undefined
    }
  }

  private async handleCustomerUpdated(
    event: CustomerUpdatedEvent
  ): Promise<FulfillmentEventResult> {
    const data = event.data as any
    const customerId = data.id
    const email = data.email
    const customData = (data.customData || data.custom_data || {}) as Record<string, unknown>
    const userId = (customData.userId || customData.user_id || null) as string | null
    const occurredAt = event.occurredAt || (event as any).occurred_at

    await this.upsertCustomerMirror({
      customerId,
      email,
      userId,
      lastEventAt: occurredAt
    })

    return {
      handled: true,
      eventType: event.eventType,
      resourceId: customerId,
      userId: userId || undefined
    }
  }

  private async handleSubscriptionCreated(
    event: SubscriptionCreatedEvent
  ): Promise<FulfillmentEventResult> {
    return this.applySubscriptionSync(event, 'subscription.created')
  }

  private async handleSubscriptionUpdated(
    event: SubscriptionUpdatedEvent
  ): Promise<FulfillmentEventResult> {
    return this.applySubscriptionSync(event, 'subscription.updated')
  }

  private async handleSubscriptionCanceled(
    event: SubscriptionCanceledEvent
  ): Promise<FulfillmentEventResult> {
    const data = event.data as any
    const subId = data.id
    const customerId = data.customerId || data.customer_id
    const customData = (data.customData || data.custom_data || {}) as Record<string, unknown>
    let userId = (customData.userId || customData.user_id || null) as string | null

    if (!userId && customerId) {
      const knownCustomer = await this.findCustomerById(customerId)
      userId = knownCustomer?.userId || null
    }

    const firstItem = Array.isArray(data.items) ? data.items[0] : undefined
    const priceObj = firstItem?.price as any
    const priceId = priceObj?.id || ''
    const productId = priceObj?.productId || priceObj?.product_id || ''

    const rawCreatedAt = data.createdAt || data.created_at
    await this.upsertSubscriptionMirror({
      subscriptionId: subId,
      customerId,
      userId,
      status: 'canceled',
      subscriptionStatus: 'canceled',
      priceId,
      productId,
      scheduledChangeAction: null,
      scheduledChangeAt: null,
      paddleCreatedAt: rawCreatedAt ? new Date(rawCreatedAt).toISOString() : null,
      lastEventAt: event.occurredAt || (event as any).occurred_at
    })

    // Revoke user quota access in database when subscription is canceled
    if (userId) {
      await this.quotaStore.syncSubscriptionMetadata({
        userId,
        subscriptionStatus: 'canceled'
      })
    }

    return {
      handled: true,
      eventType: event.eventType,
      resourceId: subId,
      userId: userId || undefined,
      credited: false
    }
  }

  private async handleTransactionCompleted(
    event: TransactionCompletedEvent
  ): Promise<FulfillmentEventResult> {
    const data = event.data as any
    const txId = String(data.id || '')
    const customerId = String(data.customerId || data.customer_id || '')
    const subscriptionId = String(data.subscriptionId || data.subscription_id || '')
    const customData = (data.customData || data.custom_data || {}) as Record<string, unknown>
    let userId = (customData.userId || customData.user_id || null) as string | null
    const occurredAt = event.occurredAt || (event as any).occurred_at || new Date().toISOString()

    if (!userId && customerId) {
      const knownCustomer = await this.findCustomerById(customerId)
      userId = knownCustomer?.userId || null
    }

    // Link Paddle customer_id <-> DualAI user_id so Customer Portal & Cancel always resolve cleanly
    if (customerId && userId) {
      const knownCustomer = await this.findCustomerById(customerId)
      await this.upsertCustomerMirror({
        customerId,
        email: knownCustomer?.email || '',
        userId,
        lastEventAt: occurredAt
      })
    }

    const firstItem = Array.isArray(data.items) ? data.items[0] : undefined
    const priceObj = firstItem?.price as any
    const priceId = priceObj?.id || ''
    const productId = priceObj?.productId || priceObj?.product_id || ''

    const matchedPlan =
      (priceId ? findPlanByPaddlePriceId(priceId) : null) ||
      (productId ? findPlanByPaddleProductId(productId) : null)

    // Backfill subscription mirror if transaction belongs to a subscription not yet mirrored
    if (subscriptionId && customerId) {
      const existingSub = this.memorySubscriptions.get(subscriptionId)
      if (!existingSub) {
        await this.upsertSubscriptionMirror({
          subscriptionId,
          customerId,
          userId,
          status: 'active',
          priceId,
          productId,
          scheduledChangeAction: null,
          scheduledChangeAt: null,
          paddleCreatedAt: occurredAt,
          lastEventAt: occurredAt
        })
      }
    }

    // SINGLE SOURCE OF TRUTH FOR CREDITING HOURS:
    // Only transaction.completed (keyed strictly by txn_*) credits hours atomically.
    // Fires once on initial checkout and once on each monthly renewal — never double-credited.
    let credited = false
    if (txId.startsWith('txn_') && userId && matchedPlan && matchedPlan.id !== 'free_tier') {
      const creditRes = await this.quotaStore.creditPurchase({
        provider: 'paddle',
        externalTransactionId: txId,
        userId,
        planId: matchedPlan.id,
        seconds: matchedPlan.includedSeconds
      })
      credited = creditRes.credited
    }

    return {
      handled: true,
      eventType: event.eventType,
      resourceId: txId,
      userId: userId || undefined,
      planId: matchedPlan?.id,
      credited
    }
  }

  /**
   * Handles approved Paddle refunds and chargebacks (adjustment.created / adjustment.updated).
   * Atomically claws back credited seconds (clamped >= 0) idempotently keyed on adjustment ID.
   */
  private async handleAdjustmentEvent(event: EventEntity): Promise<FulfillmentEventResult> {
    const data = event.data as any
    const adjustmentId = String(data.id || '')
    const action = String(data.action || '').toLowerCase()
    const status = String(data.status || '').toLowerCase()
    const customerId = String(data.customerId || data.customer_id || '')
    const transactionId = String(data.transactionId || data.transaction_id || '')

    if (
      !adjustmentId ||
      status !== 'approved' ||
      (action !== 'refund' && action !== 'chargeback')
    ) {
      return {
        handled: true,
        eventType: event.eventType,
        resourceId: adjustmentId || undefined,
        revoked: false
      }
    }

    let userId: string | null = null
    let matchedPlan = null as ReturnType<typeof findPlanByPaddlePriceId>

    if (customerId) {
      const knownCustomer = await this.findCustomerById(customerId)
      userId = knownCustomer?.userId || null
    }

    // Resolve exact original transaction plan & user via Paddle API when available
    if (transactionId && this.paddleClient) {
      try {
        const tx = (await this.paddleClient.transactions.get(transactionId)) as any
        const customData = (tx?.customData || tx?.custom_data || {}) as Record<string, unknown>
        if (!userId) {
          userId = (customData.userId || customData.user_id || null) as string | null
        }
        const firstItem = Array.isArray(tx?.items) ? tx.items[0] : undefined
        const priceId = firstItem?.price?.id || ''
        const productId = firstItem?.price?.productId || firstItem?.price?.product_id || ''
        matchedPlan =
          (priceId ? findPlanByPaddlePriceId(priceId) : null) ||
          (productId ? findPlanByPaddleProductId(productId) : null)
      } catch {
        // Fallback to local quota record below
      }
    }

    if (!matchedPlan && userId) {
      const quota = await this.quotaStore.getOrCreateUserQuota(userId)
      if (quota.planId !== 'free_tier') {
        matchedPlan = PLAN_CATALOG[quota.planId] || null
      }
    }

    let revoked = false
    if (userId && matchedPlan && matchedPlan.id !== 'free_tier') {
      const eventKind = action === 'chargeback' ? 'chargeback_clawback' : 'refund_clawback'
      const res = await this.quotaStore.revokeAdjustment({
        provider: 'paddle',
        adjustmentId,
        userId,
        planId: matchedPlan.id,
        seconds: matchedPlan.includedSeconds,
        eventKind
      })
      revoked = res.revoked
    }

    return {
      handled: true,
      eventType: event.eventType,
      resourceId: adjustmentId,
      userId: userId || undefined,
      planId: matchedPlan?.id,
      revoked
    }
  }

  private async applySubscriptionSync(
    event: SubscriptionCreatedEvent | SubscriptionUpdatedEvent,
    actionName: string
  ): Promise<FulfillmentEventResult> {
    const data = event.data as any
    const subId = data.id
    const customerId = data.customerId || data.customer_id
    const status = (data.status || 'active').toLowerCase()
    const customData = (data.customData || data.custom_data || {}) as Record<string, unknown>
    let userId = (customData.userId || customData.user_id || null) as string | null
    const occurredAt = event.occurredAt || (event as any).occurred_at || new Date().toISOString()

    if (!userId && customerId) {
      const knownCustomer = await this.findCustomerById(customerId)
      userId = knownCustomer?.userId || null
    }

    // Backfill user_id onto customer mirror so customer_id <-> user_id link is always intact
    if (customerId && userId) {
      const knownCustomer = await this.findCustomerById(customerId)
      await this.upsertCustomerMirror({
        customerId,
        email: knownCustomer?.email || '',
        userId,
        lastEventAt: occurredAt
      })
    }

    const firstItem = Array.isArray(data.items) ? data.items[0] : undefined
    const priceObj = firstItem?.price as any
    const priceId = priceObj?.id || ''
    const productId = priceObj?.productId || priceObj?.product_id || ''
    const scheduledChange = data.scheduledChange || data.scheduled_change

    const rawCreatedAt = data.createdAt || data.created_at
    await this.upsertSubscriptionMirror({
      subscriptionId: subId,
      customerId,
      userId,
      status,
      priceId,
      productId,
      scheduledChangeAction: scheduledChange?.action || null,
      scheduledChangeAt: scheduledChange?.effectiveAt || scheduledChange?.effective_at || null,
      paddleCreatedAt: rawCreatedAt ? new Date(rawCreatedAt).toISOString() : null,
      lastEventAt: occurredAt
    })

    const matchedPlan =
      (priceId ? findPlanByPaddlePriceId(priceId) : null) ||
      (productId ? findPlanByPaddleProductId(productId) : null)

    // Sync plan & subscription status metadata ONLY (never double-credit hours here;
    // hours are credited atomically & exclusively by transaction.completed).
    if (userId) {
      const mappedStatus: 'active' | 'past_due' | 'canceled' =
        status === 'canceled' || status === 'paused'
          ? 'canceled'
          : status === 'past_due'
            ? 'past_due'
            : 'active'

      await this.quotaStore.syncSubscriptionMetadata({
        userId,
        planId: matchedPlan?.id,
        subscriptionStatus: mappedStatus
      })
    }

    return {
      handled: true,
      eventType: actionName,
      resourceId: subId,
      userId: userId || undefined,
      planId: matchedPlan?.id,
      credited: false
    }
  }

  // ==========================================================================
  // Database Mirroring (Supabase PostgREST + In-Memory Fallback)
  // ==========================================================================

  public async upsertCustomerMirror(customer: MirroredCustomer): Promise<void> {
    // 1. Memory store update with monotonic ordering guard (preserving non-empty email/userId)
    const existing = this.memoryCustomers.get(customer.customerId)
    const isNewer =
      !existing ||
      !existing.lastEventAt ||
      !customer.lastEventAt ||
      new Date(customer.lastEventAt).getTime() >= new Date(existing.lastEventAt).getTime()

    if (isNewer || (!existing?.userId && customer.userId)) {
      this.memoryCustomers.set(customer.customerId, {
        ...existing,
        ...customer,
        email: customer.email || existing?.email || '',
        userId: customer.userId || existing?.userId || null,
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString()
      })
    }

    // 2. Persist to Supabase atomically (preferring RPC from migration 003, with schema-safe fallback)
    if (this.config.supabaseUrl && this.config.supabaseServiceRoleKey) {
      const base = this.config.supabaseUrl.replace(/\/$/, '')
      const headers = {
        'Content-Type': 'application/json',
        apikey: this.config.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`
      }
      try {
        const rpcRes = await fetch(`${base}/rest/v1/rpc/upsert_paddle_customer`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_customer_id: customer.customerId,
            p_email: customer.email || existing?.email || '',
            p_user_id: customer.userId || existing?.userId || null,
            p_last_event_at: customer.lastEventAt || new Date().toISOString()
          })
        })
        if (rpcRes.ok) return

        // Fallback to direct PostgREST upsert matching exact live schema columns
        const resolvedEmail = customer.email || existing?.email || 'pending@paddle.local'
        const payload: Record<string, unknown> = {
          customer_id: customer.customerId,
          email: resolvedEmail,
          last_event_at: customer.lastEventAt || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
        if (customer.userId || existing?.userId) {
          payload.user_id = customer.userId || existing?.userId
        }
        const res = await fetch(`${base}/rest/v1/customers`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(payload)
        })
        if (!res.ok) {
          console.warn(`[PaddleMirror] upsertCustomerMirror failed (${res.status})`)
        }
      } catch (err) {
        console.warn('[PaddleMirror] upsertCustomerMirror network error:', err)
      }
    }
  }

  public async upsertSubscriptionMirror(sub: MirroredSubscription): Promise<void> {
    // 1. Memory store update with monotonic ordering guard
    const existing = this.memorySubscriptions.get(sub.subscriptionId)
    if (
      !existing ||
      !existing.lastEventAt ||
      !sub.lastEventAt ||
      new Date(sub.lastEventAt).getTime() >= new Date(existing.lastEventAt).getTime()
    ) {
      this.memorySubscriptions.set(sub.subscriptionId, {
        ...existing,
        ...sub,
        userId: sub.userId || existing?.userId || null,
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString()
      })
    }

    // 2. Persist to Supabase atomically (preferring RPC from migration 003, with live-schema fallback)
    if (this.config.supabaseUrl && this.config.supabaseServiceRoleKey) {
      const base = this.config.supabaseUrl.replace(/\/$/, '')
      const headers = {
        'Content-Type': 'application/json',
        apikey: this.config.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`
      }
      try {
        const rpcRes = await fetch(`${base}/rest/v1/rpc/upsert_paddle_subscription`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            p_subscription_id: sub.subscriptionId,
            p_customer_id: sub.customerId,
            p_user_id: sub.userId || existing?.userId || null,
            p_status: sub.status,
            p_price_id: sub.priceId || existing?.priceId || '',
            p_product_id: sub.productId || existing?.productId || '',
            p_scheduled_change_action: sub.scheduledChangeAction || null,
            p_scheduled_change_at: sub.scheduledChangeAt || null,
            p_paddle_created_at: sub.paddleCreatedAt || existing?.paddleCreatedAt || null,
            p_last_event_at: sub.lastEventAt || new Date().toISOString()
          })
        })
        if (rpcRes.ok) return

        // Ensure parent customer row exists first so FK never fails on out-of-order webhooks
        await this.upsertCustomerMirror({
          customerId: sub.customerId,
          email: '',
          userId: sub.userId || existing?.userId || null,
          lastEventAt: sub.lastEventAt || new Date().toISOString()
        })

        // Exact live schema columns (uses `status`, NOT non-existent `subscription_status`)
        const payload = {
          subscription_id: sub.subscriptionId,
          customer_id: sub.customerId,
          user_id: sub.userId || existing?.userId || null,
          status: sub.status,
          price_id: sub.priceId || existing?.priceId || '',
          product_id: sub.productId || existing?.productId || '',
          scheduled_change_action: sub.scheduledChangeAction || null,
          scheduled_change_at: sub.scheduledChangeAt || null,
          paddle_created_at: sub.paddleCreatedAt || existing?.paddleCreatedAt || null,
          last_event_at: sub.lastEventAt || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
        const res = await fetch(`${base}/rest/v1/subscriptions`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(payload)
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          console.warn(`[PaddleMirror] upsertSubscriptionMirror failed (${res.status}): ${errText}`)
        }
      } catch (err) {
        console.warn('[PaddleMirror] upsertSubscriptionMirror network error:', err)
      }
    }
  }

  public async findCustomerById(customerId: string): Promise<MirroredCustomer | null> {
    const memoryHit = this.memoryCustomers.get(customerId)
    if (memoryHit) return memoryHit

    if (this.config.supabaseUrl && this.config.supabaseServiceRoleKey) {
      try {
        const url = `${this.config.supabaseUrl.replace(/\/$/, '')}/rest/v1/customers?customer_id=eq.${encodeURIComponent(customerId)}&select=*`
        const res = await fetch(url, {
          headers: {
            apikey: this.config.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`
          }
        })
        if (res.ok) {
          const rows = (await res.json()) as Array<{
            customer_id: string
            email: string
            user_id?: string
            last_event_at?: string
          }>
          if (rows.length > 0) {
            const row = rows[0]
            const cust: MirroredCustomer = {
              customerId: row.customer_id,
              email: row.email,
              userId: row.user_id || null,
              lastEventAt: row.last_event_at || null
            }
            this.memoryCustomers.set(cust.customerId, cust)
            return cust
          }
        }
      } catch {
        // Continue fallback
      }
    }

    return null
  }

  public async resolveCustomerIdForUser(user: {
    userId: string
    email?: string
  }): Promise<{ customerId: string; subscriptionIds: string[] } | null> {
    // 1. Search in local memory subscriptions / customers
    for (const [subId, sub] of this.memorySubscriptions.entries()) {
      if (sub.userId === user.userId && sub.customerId) {
        const matchedSubIds: string[] = []
        for (const [id, s] of this.memorySubscriptions.entries()) {
          if (s.customerId === sub.customerId) matchedSubIds.push(id)
        }
        return { customerId: sub.customerId, subscriptionIds: matchedSubIds }
      }
    }

    for (const cust of this.memoryCustomers.values()) {
      if (
        cust.userId === user.userId ||
        (user.email && cust.email.toLowerCase() === user.email.toLowerCase())
      ) {
        const userSubs: string[] = []
        for (const [subId, sub] of this.memorySubscriptions.entries()) {
          if (sub.customerId === cust.customerId) {
            userSubs.push(subId)
          }
        }
        return { customerId: cust.customerId, subscriptionIds: userSubs }
      }
    }

    // 2. Query Supabase database
    if (this.config.supabaseUrl && this.config.supabaseServiceRoleKey) {
      try {
        let customerId: string | null = null

        // Try querying customers by user_id or email
        const queryFilter = user.email
          ? `or=(user_id.eq.${encodeURIComponent(user.userId)},email.eq.${encodeURIComponent(user.email)})`
          : `user_id=eq.${encodeURIComponent(user.userId)}`
        const url = `${this.config.supabaseUrl.replace(/\/$/, '')}/rest/v1/customers?${queryFilter}&select=*`
        const res = await fetch(url, {
          headers: {
            apikey: this.config.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`
          }
        })

        if (res.ok) {
          const rows = (await res.json()) as Array<{ customer_id: string }>
          if (rows.length > 0) {
            customerId = rows[0].customer_id
          }
        } else if (user.email) {
          // Schema resilience: query by email only
          const emailUrl = `${this.config.supabaseUrl.replace(/\/$/, '')}/rest/v1/customers?email=eq.${encodeURIComponent(user.email)}&select=customer_id`
          const emailRes = await fetch(emailUrl, {
            headers: {
              apikey: this.config.supabaseServiceRoleKey,
              Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`
            }
          })
          if (emailRes.ok) {
            const rows = (await emailRes.json()) as Array<{ customer_id: string }>
            if (rows.length > 0) customerId = rows[0].customer_id
          }
        }

        if (customerId) {
          // Look up subscriptions for this customer in subscriptions table
          const subUrl = `${this.config.supabaseUrl.replace(/\/$/, '')}/rest/v1/subscriptions?customer_id=eq.${encodeURIComponent(customerId)}&select=subscription_id`
          const subRes = await fetch(subUrl, {
            headers: {
              apikey: this.config.supabaseServiceRoleKey,
              Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`
            }
          })
          const subIds: string[] = []
          if (subRes.ok) {
            const subRows = (await subRes.json()) as Array<{ subscription_id: string }>
            for (const r of subRows) {
              if (r.subscription_id) subIds.push(r.subscription_id)
            }
          }
          return { customerId, subscriptionIds: subIds }
        }
      } catch {
        // Continue to Paddle API check
      }
    }

    // 3. Fallback: Query Paddle API directly via SDK if customer completed checkout with user's email
    if (this.paddleClient && user.email) {
      try {
        const customerCollection = await this.paddleClient.customers.list({
          search: user.email
        })
        const items = await customerCollection.next()
        if (items && items.length > 0) {
          const found =
            items.find((c) => c.email.toLowerCase() === user.email?.toLowerCase()) || items[0]
          
          const subIds: string[] = []
          try {
            const subCollection = await this.paddleClient.subscriptions.list({
              customerId: [found.id]
            })
            const subItems = await subCollection.next()
            if (subItems && subItems.length > 0) {
              for (const s of subItems) {
                if (s.id) subIds.push(s.id)
              }
            }
          } catch {
            // Subscription query fallback
          }

          return { customerId: found.id, subscriptionIds: subIds }
        }
      } catch {
        // Paddle list fallback failure
      }
    }

    return null
  }

  // ==========================================================================
  // Part 3: Customer Portal Session Minting
  // ==========================================================================

  private formatHumanDate(iso?: string | null): string | null {
    if (!iso) return null
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    })
  }

  private extractPaddleErrorCode(err: unknown): string {
    if (err instanceof ApiError && typeof err.code === 'string') {
      return err.code
    }
    if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string') {
      return (err as { code: string }).code
    }
    return ''
  }

  /**
   * Maps every known Paddle Billing API error code and network failure to a calm,
   * consumer-friendly message enriched with authoritative dates from the DB/Paddle.
   */
  private mapPaddleBillingError(
    err: unknown,
    operation: 'cancel' | 'undo_cancel' | 'checkout' | 'portal',
    synced?: AccountSubscriptionSummary | null
  ): string {
    const code = this.extractPaddleErrorCode(err)

    if (code === 'subscription_locked_pending_changes') {
      const dateStr = this.formatHumanDate(synced?.scheduledChangeAt)
      if (synced?.scheduledChangeAction === 'cancel') {
        return dateStr
          ? `Your subscription is already scheduled to end on ${dateStr}. You keep full access and all remaining hours until then.`
          : 'Your subscription is already scheduled to end at the close of your current billing period.'
      }
      if (synced?.scheduledChangeAction === 'pause') {
        return dateStr
          ? `Your subscription is scheduled to pause on ${dateStr}. Review or change this in Manage Billing.`
          : 'Your subscription is already scheduled to pause. Review or change this in Manage Billing.'
      }
      if (synced?.scheduledChangeAction === 'resume') {
        return dateStr
          ? `Your subscription is scheduled to resume on ${dateStr}. Review or change this in Manage Billing.`
          : 'Your subscription is scheduled to resume. Review or change this in Manage Billing.'
      }
      return 'Your subscription already has a pending change scheduled. Please review it in Manage Billing.'
    }

    if (code === 'subscription_locked_renewal') {
      return 'Your subscription is currently renewing. Please try again in a few minutes.'
    }

    if (code === 'subscription_locked_processing') {
      return 'A billing update is currently being processed. Please try again in a moment.'
    }

    if (
      code === 'subscription_not_active' ||
      code === 'subscription_is_canceled' ||
      code === 'subscription_update_when_canceled' ||
      code === 'subscription_cannot_be_canceled'
    ) {
      if (synced?.status === 'canceled') {
        return 'This subscription has already ended.'
      }
      if (synced?.status === 'past_due') {
        return 'Your subscription has a past-due payment. Please update your payment method in Manage Billing.'
      }
      if (synced?.status === 'paused') {
        return 'Your subscription is currently paused. You can resume or manage it in Manage Billing.'
      }
      return 'This subscription is not currently active.'
    }

    if (code === 'subscription_payment_declined' || code === 'transaction_payment_failed') {
      return 'Your payment method could not be charged. Please update your card in Manage Billing.'
    }

    if (code === 'too_many_requests' || code === 'rate_limit_exceeded') {
      return 'The billing service is temporarily busy. Please try again in a moment.'
    }

    if (operation === 'cancel') {
      return 'Unable to cancel your subscription right now. Please try again or use Manage Billing.'
    }
    if (operation === 'undo_cancel') {
      return 'Unable to keep your subscription right now. Please try again or use Manage Billing.'
    }
    if (operation === 'portal') {
      return 'Unable to open Manage Billing right now. Please try again in a moment.'
    }
    return 'Unable to start checkout right now. Please try again in a moment.'
  }

  /**
   * Mints an authenticated Paddle Customer Portal session URL.
   * Client-supplied customer IDs are never trusted: customer ID is resolved server-side.
   */
  public async createCustomerPortalSession(user: {
    userId: string
    email?: string
  }): Promise<{ ok: boolean; portalUrl?: string; error?: string }> {
    if (!this.paddleClient) {
      return {
        ok: false,
        error: 'Billing portal is temporarily unavailable.'
      }
    }

    const resolved = await this.resolveCustomerIdForUser(user)
    if (!resolved || !resolved.customerId) {
      return {
        ok: false,
        error:
          'No billing history yet. Once you choose a paid plan, your invoices and payment settings will appear here.'
      }
    }

    try {
      // Pass subscription IDs (up to 25) for deep links, or [] for general overview
      const session = await this.paddleClient.customerPortalSessions.create(
        resolved.customerId,
        resolved.subscriptionIds.slice(0, 25)
      )

      const portalUrl = session.urls.general.overview
      if (!portalUrl) {
        return {
          ok: false,
          error: 'Unable to open Manage Billing right now. Please try again in a moment.'
        }
      }

      return {
        ok: true,
        portalUrl
      }
    } catch (err) {
      return {
        ok: false,
        error: this.mapPaddleBillingError(err, 'portal')
      }
    }
  }

  private toSubscriptionSummary(
    sub: {
      subscriptionId: string
      status: string
      priceId?: string
      productId?: string
      scheduledChangeAction?: string | null
      scheduledChangeAt?: string | null
      nextBilledAt?: string | null
    }
  ): AccountSubscriptionSummary {
    const matchedPlan =
      (sub.priceId ? findPlanByPaddlePriceId(sub.priceId) : null) ||
      (sub.productId ? findPlanByPaddleProductId(sub.productId) : null)
    const rawStatus = (sub.status || 'active').toLowerCase()
    const normalizedStatus: AccountSubscriptionSummary['status'] =
      rawStatus === 'trialing' ||
      rawStatus === 'past_due' ||
      rawStatus === 'paused' ||
      rawStatus === 'canceled'
        ? rawStatus
        : 'active'
    const rawAction = sub.scheduledChangeAction?.toLowerCase() || null
    const scheduledChangeAction: AccountSubscriptionSummary['scheduledChangeAction'] =
      rawAction === 'cancel' || rawAction === 'pause' || rawAction === 'resume' ? rawAction : null

    return {
      subscriptionId: sub.subscriptionId,
      planId: matchedPlan?.id || 'pro_40h',
      status: normalizedStatus,
      scheduledChangeAction,
      scheduledChangeAt: sub.scheduledChangeAt || null,
      nextBilledAt: sub.nextBilledAt || null
    }
  }

  /**
   * Resolves the authenticated user's authoritative subscription summary (slim DTO).
   * Checks local mirror -> Supabase DB -> Paddle API fallback (with mirror backfill).
   */
  public async getActiveSubscriptionForUser(user: {
    userId: string
    email?: string
  }): Promise<AccountSubscriptionSummary | null> {
    const pickBest = <T extends { status: string; updatedAt?: string; createdAt?: string }>(
      list: T[]
    ): T | null => {
      if (list.length === 0) return null
      const nonCanceled = list.filter((s) => s.status.toLowerCase() !== 'canceled')
      const pool = nonCanceled.length > 0 ? nonCanceled : list
      return pool.sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime()
      )[0]
    }

    // 1. Check Supabase mirror first when configured (source of truth in production)
    if (this.config.supabaseUrl && this.config.supabaseServiceRoleKey) {
      try {
        const base = this.config.supabaseUrl.replace(/\/$/, '')
        const headers = {
          apikey: this.config.supabaseServiceRoleKey,
          Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`
        }

        const resolvedCustomer = await this.resolveCustomerIdForUser(user)
        const filter = resolvedCustomer?.customerId
          ? `or=(user_id.eq.${encodeURIComponent(user.userId)},customer_id.eq.${encodeURIComponent(resolvedCustomer.customerId)})`
          : `user_id=eq.${encodeURIComponent(user.userId)}`

        const subRes = await fetch(
          `${base}/rest/v1/subscriptions?${filter}&select=*&order=updated_at.desc&limit=10`,
          { headers }
        )

        if (subRes.ok) {
          const rows = (await subRes.json()) as Array<{
            subscription_id: string
            customer_id: string
            user_id: string | null
            status: string
            price_id: string
            product_id: string
            scheduled_change_action: string | null
            scheduled_change_at: string | null
            updated_at: string
          }>
          const chosen = pickBest(
            rows.map((r) => ({
              subscriptionId: r.subscription_id,
              status: r.status,
              priceId: r.price_id,
              productId: r.product_id,
              scheduledChangeAction: r.scheduled_change_action,
              scheduledChangeAt: r.scheduled_change_at,
              updatedAt: r.updated_at
            }))
          )
          if (chosen) {
            return this.toSubscriptionSummary(chosen)
          }
        }
      } catch {
        // Continue to memory & Paddle API fallback
      }
    }

    // 2. Check in-memory mirror
    const memCustomerIds = new Set<string>()
    for (const c of this.memoryCustomers.values()) {
      if (
        c.userId === user.userId ||
        (user.email && c.email && c.email.toLowerCase() === user.email.toLowerCase())
      ) {
        memCustomerIds.add(c.customerId)
      }
    }
    const memSubs: MirroredSubscription[] = []
    for (const s of this.memorySubscriptions.values()) {
      if (s.userId === user.userId || memCustomerIds.has(s.customerId)) {
        memSubs.push(s)
      }
    }
    const memBest = pickBest(memSubs)
    if (memBest) {
      return this.toSubscriptionSummary(memBest)
    }

    // 3. Fallback: Query Paddle API directly for customer's live subscription & backfill mirror
    if (this.paddleClient && user.email) {
      try {
        const resolved = await this.resolveCustomerIdForUser(user)
        if (resolved?.customerId) {
          const subCollection = await this.paddleClient.subscriptions.list({
            customerId: [resolved.customerId]
          })
          const items = (await subCollection.next()) || []
          if (items.length > 0) {
            const bestLive = pickBest(
              items.map((s: any) => ({
                raw: s,
                status: String(s.status || 'active'),
                updatedAt: String(s.updatedAt || s.createdAt || '')
              }))
            )
            if (bestLive) {
              const s = bestLive.raw as any
              const firstItem = Array.isArray(s.items) ? s.items[0] : undefined
              const priceId = firstItem?.price?.id || ''
              const productId = firstItem?.price?.productId || firstItem?.price?.product_id || ''
              const scheduledAction = s.scheduledChange?.action || null
              const scheduledAt = s.scheduledChange?.effectiveAt || null
              const nextBilledAt = s.nextBilledAt || null

              // Backfill customer + subscription mirror so future reads are instant from DB
              await this.upsertSubscriptionMirror({
                subscriptionId: s.id,
                customerId: resolved.customerId,
                userId: user.userId,
                status: String(s.status || 'active').toLowerCase(),
                priceId,
                productId,
                scheduledChangeAction: scheduledAction,
                scheduledChangeAt: scheduledAt,
                paddleCreatedAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
                lastEventAt: s.updatedAt || new Date().toISOString()
              })

              return this.toSubscriptionSummary({
                subscriptionId: s.id,
                status: String(s.status || 'active'),
                priceId,
                productId,
                scheduledChangeAction: scheduledAction,
                scheduledChangeAt: scheduledAt,
                nextBilledAt
              })
            }
          }
        }
      } catch {
        // Fallback failed gracefully
      }
    }

    return null
  }

  /**
   * Reconciles a single subscription directly from the live Paddle API into
   * Supabase and in-memory mirrors so stale DB rows self-heal automatically.
   */
  private async syncSubscriptionFromPaddle(
    subscriptionId: string,
    userId: string,
    fallbackCustomerId: string
  ): Promise<AccountSubscriptionSummary | null> {
    if (!this.paddleClient) return null
    try {
      const live = (await this.paddleClient.subscriptions.get(subscriptionId)) as any
      if (!live?.id) return null

      const firstItem = Array.isArray(live.items) ? live.items[0] : undefined
      const priceId = firstItem?.price?.id || ''
      const productId = firstItem?.price?.productId || firstItem?.price?.product_id || ''
      const nextStatus = String(live.status || 'active').toLowerCase()
      const scheduledChange = live.scheduledChange || live.scheduled_change || null
      const scheduledAction = scheduledChange?.action || null
      const scheduledAt = scheduledChange?.effectiveAt || scheduledChange?.effective_at || null
      const nextBilledAt = live.nextBilledAt || live.next_billed_at || null
      const resolvedCustomerId = live.customerId || live.customer_id || fallbackCustomerId
      const eventTimestamp = live.updatedAt || live.updated_at || new Date().toISOString()

      await this.upsertSubscriptionMirror({
        subscriptionId: live.id,
        customerId: resolvedCustomerId,
        userId,
        status: nextStatus,
        priceId,
        productId,
        scheduledChangeAction: scheduledAction,
        scheduledChangeAt: scheduledAt,
        paddleCreatedAt:
          live.createdAt || live.created_at
            ? new Date(live.createdAt || live.created_at).toISOString()
            : null,
        lastEventAt: eventTimestamp
      })

      if (nextStatus === 'canceled') {
        await this.quotaStore.syncSubscriptionMetadata({
          userId,
          subscriptionStatus: 'canceled'
        })
      }

      return this.toSubscriptionSummary({
        subscriptionId: live.id,
        status: nextStatus,
        priceId,
        productId,
        scheduledChangeAction: scheduledAction,
        scheduledChangeAt: scheduledAt,
        nextBilledAt
      })
    } catch {
      return null
    }
  }

  /**
   * Explicitly reconciles the user's active subscription against live Paddle API
   * (used on explicit Account Refresh or post-portal return) so any delayed or
   * missed webhook self-heals into Supabase immediately.
   */
  public async reconcileActiveSubscriptionForUser(user: {
    userId: string
    email?: string
  }): Promise<AccountSubscriptionSummary | null> {
    const current = await this.getActiveSubscriptionForUser(user)
    if (!current || !this.paddleClient) {
      return current
    }
    const resolvedCustomer = await this.resolveCustomerIdForUser(user)
    const synced = await this.syncSubscriptionFromPaddle(
      current.subscriptionId,
      user.userId,
      resolvedCustomer?.customerId || ''
    )
    return synced || current
  }

  /**
   * Cancels the authenticated user's own subscription via Paddle API with strict
   * server-side ownership verification and safe `next_billing_period` default.
   */
  public async cancelSubscriptionForUser(user: {
    userId: string
    email?: string
  }): Promise<{
    ok: boolean
    subscription?: AccountSubscriptionSummary
    alreadyScheduled?: boolean
    message?: string
    error?: string
  }> {
    if (!this.paddleClient) {
      return { ok: false, error: 'Billing service is temporarily unavailable.' }
    }

    const activeSub = await this.getActiveSubscriptionForUser(user)
    if (!activeSub || activeSub.status === 'canceled') {
      return {
        ok: false,
        subscription: activeSub || undefined,
        error: 'No active subscription found for your account.'
      }
    }
    if (activeSub.scheduledChangeAction === 'cancel') {
      const endDate = this.formatHumanDate(activeSub.scheduledChangeAt)
      return {
        ok: true,
        alreadyScheduled: true,
        subscription: activeSub,
        message: endDate
          ? `Your subscription is already scheduled to end on ${endDate}. You keep full access and all remaining hours until then.`
          : 'Your subscription is already scheduled to end at the close of your current billing period.'
      }
    }

    const resolvedCustomer = await this.resolveCustomerIdForUser(user)
    if (!resolvedCustomer?.customerId) {
      return { ok: false, error: 'Unable to verify your billing profile. Please try again.' }
    }

    const effectiveFrom = activeSub.status === 'paused' ? 'immediately' : 'next_billing_period'

    try {
      const updated = (await this.paddleClient.subscriptions.cancel(activeSub.subscriptionId, {
        effectiveFrom
      })) as any

      const firstItem = Array.isArray(updated?.items) ? updated.items[0] : undefined
      const priceId = firstItem?.price?.id || ''
      const productId = firstItem?.price?.productId || firstItem?.price?.product_id || ''
      const nextStatus = String(updated?.status || activeSub.status).toLowerCase()
      const scheduledChange = updated?.scheduledChange || updated?.scheduled_change || null
      const scheduledAction = scheduledChange?.action || null
      const scheduledAt = scheduledChange?.effectiveAt || scheduledChange?.effective_at || null
      const nowIso = new Date().toISOString()

      await this.upsertSubscriptionMirror({
        subscriptionId: activeSub.subscriptionId,
        customerId: resolvedCustomer.customerId,
        userId: user.userId,
        status: nextStatus,
        priceId,
        productId,
        scheduledChangeAction: scheduledAction,
        scheduledChangeAt: scheduledAt,
        lastEventAt: nowIso
      })

      if (nextStatus === 'canceled') {
        await this.quotaStore.syncSubscriptionMetadata({
          userId: user.userId,
          subscriptionStatus: 'canceled'
        })
      }

      const summary = this.toSubscriptionSummary({
        subscriptionId: activeSub.subscriptionId,
        status: nextStatus,
        priceId,
        productId,
        scheduledChangeAction: scheduledAction,
        scheduledChangeAt: scheduledAt,
        nextBilledAt: updated?.nextBilledAt || updated?.next_billed_at || null
      })

      const endDate = this.formatHumanDate(summary.scheduledChangeAt)
      return {
        ok: true,
        alreadyScheduled: false,
        subscription: summary,
        message:
          nextStatus === 'canceled'
            ? 'Your subscription has been canceled.'
            : endDate
              ? `Your subscription is scheduled to end on ${endDate}. You keep full access and all remaining hours until then.`
              : 'Your subscription is scheduled to cancel at the end of your current billing period. You keep access and remaining hours until then.'
      }
    } catch (err) {
      const apiCode = this.extractPaddleErrorCode(err)

      // Self-heal stale mirror if Paddle reports pending changes or state mismatch
      if (
        apiCode === 'subscription_locked_pending_changes' ||
        apiCode === 'subscription_not_active' ||
        apiCode === 'subscription_is_canceled' ||
        apiCode === 'subscription_update_when_canceled' ||
        apiCode === 'subscription_cannot_be_canceled'
      ) {
        const synced = await this.syncSubscriptionFromPaddle(
          activeSub.subscriptionId,
          user.userId,
          resolvedCustomer.customerId
        )
        if (synced) {
          if (synced.scheduledChangeAction === 'cancel') {
            const endDate = this.formatHumanDate(synced.scheduledChangeAt)
            return {
              ok: true,
              alreadyScheduled: true,
              subscription: synced,
              message: endDate
                ? `Your subscription is already scheduled to end on ${endDate}. You keep full access and all remaining hours until then.`
                : 'Your subscription is already scheduled to end at the close of your current billing period.'
            }
          }
          return {
            ok: false,
            subscription: synced,
            error: this.mapPaddleBillingError(err, 'cancel', synced)
          }
        }
      }

      return {
        ok: false,
        error: this.mapPaddleBillingError(err, 'cancel')
      }
    }
  }

  /**
   * Reverts a scheduled end-of-period cancellation so the user keeps their subscription.
   */
  public async undoCancelSubscriptionForUser(user: {
    userId: string
    email?: string
  }): Promise<{
    ok: boolean
    subscription?: AccountSubscriptionSummary
    alreadyActive?: boolean
    message?: string
    error?: string
  }> {
    if (!this.paddleClient) {
      return { ok: false, error: 'Billing service is temporarily unavailable.' }
    }

    const activeSub = await this.getActiveSubscriptionForUser(user)
    if (!activeSub || activeSub.status === 'canceled') {
      return {
        ok: false,
        subscription: activeSub || undefined,
        error: 'No active subscription found for your account.'
      }
    }

    const resolvedCustomer = await this.resolveCustomerIdForUser(user)
    if (!resolvedCustomer?.customerId) {
      return { ok: false, error: 'Unable to verify your billing profile. Please try again.' }
    }

    try {
      const updated = (await this.paddleClient.subscriptions.update(activeSub.subscriptionId, {
        scheduledChange: null
      })) as any

      const firstItem = Array.isArray(updated?.items) ? updated.items[0] : undefined
      const priceId = firstItem?.price?.id || ''
      const productId = firstItem?.price?.productId || firstItem?.price?.product_id || ''
      const nextStatus = String(updated?.status || activeSub.status).toLowerCase()
      const nextBilledAt = updated?.nextBilledAt || updated?.next_billed_at || null
      const nowIso = new Date().toISOString()

      await this.upsertSubscriptionMirror({
        subscriptionId: activeSub.subscriptionId,
        customerId: resolvedCustomer.customerId,
        userId: user.userId,
        status: nextStatus,
        priceId,
        productId,
        scheduledChangeAction: null,
        scheduledChangeAt: null,
        lastEventAt: nowIso
      })

      const summary = this.toSubscriptionSummary({
        subscriptionId: activeSub.subscriptionId,
        status: nextStatus,
        priceId,
        productId,
        scheduledChangeAction: null,
        scheduledChangeAt: null,
        nextBilledAt
      })
      const renewDate = this.formatHumanDate(nextBilledAt)

      return {
        ok: true,
        alreadyActive: false,
        subscription: summary,
        message: renewDate
          ? `Cancellation undone. Your subscription remains active and renews on ${renewDate}.`
          : 'Cancellation undone. Your subscription will continue as normal.'
      }
    } catch (err) {
      const synced = await this.syncSubscriptionFromPaddle(
        activeSub.subscriptionId,
        user.userId,
        resolvedCustomer.customerId
      )
      if (synced && synced.scheduledChangeAction === null && synced.status !== 'canceled') {
        return {
          ok: true,
          alreadyActive: true,
          subscription: synced,
          message: 'Your subscription is already active and will continue as normal.'
        }
      }
      return {
        ok: false,
        subscription: synced || undefined,
        error: this.mapPaddleBillingError(err, 'undo_cancel', synced)
      }
    }
  }

  /**
   * Generates an official Paddle hosted checkout URL for a plan transaction.
   * Opens in in-app modal window, preventing duplicate subscriptions on the same active plan.
   */
  public async createPaddleCheckoutTransaction(
    planId: string,
    user: { userId: string; email?: string }
  ): Promise<{ ok: boolean; checkoutUrl?: string; error?: string }> {
    if (!this.paddleClient) {
      return { ok: false, error: 'Billing service is temporarily unavailable.' }
    }

    const plan = PLAN_CATALOG[planId as PlanId]
    if (!plan || !plan.paddlePriceId) {
      return { ok: false, error: 'Selected plan is unavailable. Please choose another plan.' }
    }

    // Prevent accidental double subscription on the exact same active plan.
    // Reconcile against live Paddle before blocking so a user who canceled in
    // the Customer Portal is never wrongly blocked by a stale DB mirror.
    let existingSub = await this.getActiveSubscriptionForUser(user)
    if (
      existingSub &&
      hasPaidAccess(existingSub.status) &&
      existingSub.planId === plan.id &&
      existingSub.scheduledChangeAction !== 'cancel'
    ) {
      const reconciled = await this.reconcileActiveSubscriptionForUser(user)
      if (reconciled) existingSub = reconciled
    }

    if (
      existingSub &&
      hasPaidAccess(existingSub.status) &&
      existingSub.planId === plan.id &&
      existingSub.scheduledChangeAction !== 'cancel'
    ) {
      return {
        ok: false,
        error: `You already have an active ${plan.name} subscription.`
      }
    }

    try {
      const resolvedCustomer = await this.resolveCustomerIdForUser(user)

      const transaction = await this.paddleClient.transactions.create({
        items: [{ priceId: plan.paddlePriceId, quantity: 1 }],
        ...(resolvedCustomer?.customerId ? { customerId: resolvedCustomer.customerId } : {}),
        customData: {
          userId: user.userId,
          planId: plan.id
        }
      })

      // Checkout runs on our approved domain page (hosts Paddle.js) inside an in-app window.
      const base = (this.config.paddleCheckoutBaseUrl || '').trim()
      const checkoutUrl = base
        ? `${base}${base.includes('?') ? '&' : '?'}_ptxn=${encodeURIComponent(transaction.id)}`
        : transaction.checkout?.url
      if (!checkoutUrl) {
        return {
          ok: false,
          error: 'Unable to start checkout right now. Please try again in a moment.'
        }
      }

      return { ok: true, checkoutUrl }
    } catch (err) {
      return { ok: false, error: this.mapPaddleBillingError(err, 'checkout') }
    }
  }
}
