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
  priceId: string
  productId: string
  scheduledChangeAction?: string | null
  scheduledChangeAt?: string | null
  paddleCreatedAt?: string | null
  lastEventAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface FulfillmentEventResult {
  handled: boolean
  eventType: string
  resourceId?: string
  userId?: string
  planId?: string
  credited?: boolean
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
      priceId,
      productId,
      scheduledChangeAction: null,
      scheduledChangeAt: null,
      paddleCreatedAt: rawCreatedAt ? new Date(rawCreatedAt).toISOString() : null,
      lastEventAt: event.occurredAt || (event as any).occurred_at
    })

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
    const txId = data.id
    const customerId = data.customerId || data.customer_id || ''
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

    const matchedPlan =
      (priceId ? findPlanByPaddlePriceId(priceId) : null) ||
      (productId ? findPlanByPaddleProductId(productId) : null)

    let credited = false
    if (userId && matchedPlan && matchedPlan.id !== 'free_tier') {
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

    if (!userId && customerId) {
      const knownCustomer = await this.findCustomerById(customerId)
      userId = knownCustomer?.userId || null
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
      lastEventAt: event.occurredAt || (event as any).occurred_at
    })

    const grantsPaidAccess = hasPaidAccess(status)
    const matchedPlan =
      (priceId ? findPlanByPaddlePriceId(priceId) : null) ||
      (productId ? findPlanByPaddleProductId(productId) : null)

    let credited = false
    if (grantsPaidAccess && userId && matchedPlan && matchedPlan.id !== 'free_tier') {
      const creditResult = await this.quotaStore.creditPurchase({
        provider: 'paddle',
        externalTransactionId: subId,
        userId,
        planId: matchedPlan.id,
        seconds: matchedPlan.includedSeconds
      })
      credited = creditResult.credited
    }

    return {
      handled: true,
      eventType: actionName,
      resourceId: subId,
      userId: userId || undefined,
      planId: matchedPlan?.id,
      credited
    }
  }

  // ==========================================================================
  // Database Mirroring (Supabase PostgREST + In-Memory Fallback)
  // ==========================================================================

  public async upsertCustomerMirror(customer: MirroredCustomer): Promise<void> {
    // 1. Memory store update with ordering guard
    const existing = this.memoryCustomers.get(customer.customerId)
    if (
      !existing ||
      !existing.lastEventAt ||
      !customer.lastEventAt ||
      new Date(customer.lastEventAt).getTime() >= new Date(existing.lastEventAt).getTime()
    ) {
      this.memoryCustomers.set(customer.customerId, {
        ...existing,
        ...customer,
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString()
      })
    }

    // 2. Persist to Supabase if configured (idempotent ON CONFLICT / merge-duplicates)
    if (this.config.supabaseUrl && this.config.supabaseServiceRoleKey) {
      try {
        const url = `${this.config.supabaseUrl.replace(/\/$/, '')}/rest/v1/customers`
        const fullPayload = {
          customer_id: customer.customerId,
          email: customer.email,
          user_id: customer.userId || null,
          last_event_at: customer.lastEventAt || null,
          updated_at: new Date().toISOString()
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: this.config.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
            Prefer: 'resolution=merge-duplicates'
          },
          body: JSON.stringify(fullPayload)
        })

        // Resilient fallback: If live DB has only the base schema without optional metadata columns
        if (!res.ok && res.status === 400) {
          const minimalPayload = {
            customer_id: customer.customerId,
            email: customer.email,
            updated_at: new Date().toISOString()
          }
          await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: this.config.supabaseServiceRoleKey,
              Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
              Prefer: 'resolution=merge-duplicates'
            },
            body: JSON.stringify(minimalPayload)
          })
        }
      } catch {
        // PostgREST upsert failed; memory cache already preserved
      }
    }
  }

  public async upsertSubscriptionMirror(sub: MirroredSubscription): Promise<void> {
    // 1. Memory store update with ordering guard
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
        updatedAt: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString()
      })
    }

    // 2. Persist to Supabase if configured (idempotent ON CONFLICT / merge-duplicates)
    if (this.config.supabaseUrl && this.config.supabaseServiceRoleKey) {
      try {
        const url = `${this.config.supabaseUrl.replace(/\/$/, '')}/rest/v1/subscriptions`
        const fullPayload = {
          subscription_id: sub.subscriptionId,
          customer_id: sub.customerId,
          user_id: sub.userId || null,
          status: sub.status,
          price_id: sub.priceId,
          product_id: sub.productId,
          scheduled_change_action: sub.scheduledChangeAction || null,
          scheduled_change_at: sub.scheduledChangeAt || null,
          paddle_created_at: sub.paddleCreatedAt || null,
          last_event_at: sub.lastEventAt || null,
          updated_at: new Date().toISOString()
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: this.config.supabaseServiceRoleKey,
            Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
            Prefer: 'resolution=merge-duplicates'
          },
          body: JSON.stringify(fullPayload)
        })

        // Resilient fallback: If live DB has only the base schema without optional metadata columns
        if (!res.ok && res.status === 400) {
          const minimalPayload = {
            subscription_id: sub.subscriptionId,
            customer_id: sub.customerId,
            status: sub.status,
            price_id: sub.priceId,
            product_id: sub.productId,
            scheduled_change_action: sub.scheduledChangeAction || null,
            scheduled_change_at: sub.scheduledChangeAt || null,
            updated_at: new Date().toISOString()
          }
          await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: this.config.supabaseServiceRoleKey,
              Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
              Prefer: 'resolution=merge-duplicates'
            },
            body: JSON.stringify(minimalPayload)
          })
        }
      } catch {
        // Supabase mirror write silent fallback to memory cache
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
        error: 'Paddle API key is not configured on Gateway.'
      }
    }

    const resolved = await this.resolveCustomerIdForUser(user)
    if (!resolved || !resolved.customerId) {
      return {
        ok: false,
        error: 'No active Paddle subscription or customer record found for this account.'
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
          error: 'Paddle did not return a customer portal overview URL.'
        }
      }

      return {
        ok: true,
        portalUrl
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Paddle customer portal session failed.'
      return {
        ok: false,
        error: msg
      }
    }
  }

  /**
   * Generates an official Paddle hosted checkout URL for a plan transaction.
   * Opens in external browser, avoiding Electron iframe ERR_BLOCKED_BY_RESPONSE restrictions.
   */
  public async createPaddleCheckoutTransaction(
    planId: string,
    user: { userId: string; email?: string }
  ): Promise<{ ok: boolean; checkoutUrl?: string; error?: string }> {
    if (!this.paddleClient) {
      return { ok: false, error: 'Paddle API client is not configured on Gateway.' }
    }

    const plan = PLAN_CATALOG[planId as PlanId]
    if (!plan || !plan.paddlePriceId) {
      return { ok: false, error: 'Invalid plan or missing Paddle Price ID.' }
    }

    try {
      const transaction = await this.paddleClient.transactions.create({
        items: [{ priceId: plan.paddlePriceId, quantity: 1 }],
        customData: {
          userId: user.userId,
          planId: plan.id
        }
      })

      const checkoutUrl = transaction.checkout?.url
      if (!checkoutUrl) {
        return { ok: false, error: 'Paddle did not return a checkout URL for this transaction.' }
      }

      return { ok: true, checkoutUrl }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Paddle transaction creation failed.'
      return { ok: false, error: msg }
    }
  }
}
