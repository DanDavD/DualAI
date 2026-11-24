/**
 * DUALAI ZERO-TRUST CLOUD GATEWAY - Authoritative Quota & Plan Store
 * Enforces server-side 1-hour Free Tier (3,600s), atomic usage metering,
 * and idempotent billing credit across Microsoft Store, PayPal, and Paddle.
 */

import { GatewayConfig } from '../config.js'

export type PlanId = 'free_tier' | 'pro_40h' | 'pro_plus_70h' | 'unlimited'

export interface PlanCatalogItem {
  id: PlanId
  name: string
  description: string
  includedSeconds: number
  monthlyPriceUsd: number
  msStoreProductId: string | null
  maxConcurrentSessions: number
  isUnlimitedFairUse?: boolean
}

export interface UserQuotaRecord {
  userId: string
  planId: PlanId
  remainingSeconds: number
  totalAllocatedSeconds: number
  totalConsumedSeconds: number
  subscriptionStatus: 'free_trial' | 'active' | 'past_due' | 'exhausted' | 'canceled'
  maxConcurrentSessions: number
}

export interface DeductionResult {
  remainingSeconds: number
  totalAllocatedSeconds: number
  totalConsumedSeconds: number
  exhausted: boolean
}

export interface CreditPurchaseResult {
  credited: boolean
  remainingSeconds: number
  totalAllocatedSeconds: number
}

export const PLAN_CATALOG: Record<PlanId, PlanCatalogItem> = {
  free_tier: {
    id: 'free_tier',
    name: 'Free Trial (1 Hour)',
    description: 'Automatic 1-hour real-time interpretation trial. All features included.',
    includedSeconds: 3600,
    monthlyPriceUsd: 0,
    msStoreProductId: null,
    maxConcurrentSessions: 1
  },
  pro_40h: {
    id: 'pro_40h',
    name: 'Pro (40 Hours)',
    description: '40 hours/month of unified multi-speaker live translation across 60+ languages.',
    includedSeconds: 144000,
    monthlyPriceUsd: 6.99,
    msStoreProductId: '9NBLGGH4DUAL40H',
    maxConcurrentSessions: 1
  },
  pro_plus_70h: {
    id: 'pro_plus_70h',
    name: 'Pro+ (70 Hours)',
    description: '70 hours/month for active medical, legal, and business interpreters.',
    includedSeconds: 252000,
    monthlyPriceUsd: 9.99,
    msStoreProductId: '9NBLGGH4DUAL70H',
    maxConcurrentSessions: 1
  },
  unlimited: {
    id: 'unlimited',
    name: 'Unlimited',
    description: 'Unlimited monthly interpretation for full-time interpreters (single-user fair use).',
    includedSeconds: 576000, // 160h monthly fair-use cap preventing multi-user account sharing
    monthlyPriceUsd: 19.99,
    msStoreProductId: '9NBLGGH4DUALUNL',
    maxConcurrentSessions: 1,
    isUnlimitedFairUse: true
  }
}

export function findPlanByMsStoreProductId(productId: string): PlanCatalogItem | null {
  for (const plan of Object.values(PLAN_CATALOG)) {
    if (plan.msStoreProductId && plan.msStoreProductId === productId) {
      return plan
    }
  }
  return null
}

export interface QuotaStore {
  getOrCreateUserQuota(userId: string): Promise<UserQuotaRecord>
  deductSeconds(
    userId: string,
    sessionId: string,
    seconds: number,
    channelMode: string
  ): Promise<DeductionResult>
  creditPurchase(params: {
    provider: 'microsoft_store' | 'paypal' | 'paddle'
    externalTransactionId: string
    userId: string
    planId: PlanId
    seconds: number
  }): Promise<CreditPurchaseResult>
  setTestQuotaSeconds?(userId: string, remainingSeconds: number): void
}

/**
 * Local development & automated penetration test in-memory authoritative quota store.
 * Automatically provisions 3,600 seconds (1 hour Free Tier) on first user access.
 */
export class InMemoryQuotaStore implements QuotaStore {
  private quotas: Map<string, UserQuotaRecord> = new Map()
  private processedTxKeys: Set<string> = new Set()

  public async getOrCreateUserQuota(userId: string): Promise<UserQuotaRecord> {
    let record = this.quotas.get(userId)
    if (!record) {
      record = {
        userId,
        planId: 'free_tier',
        remainingSeconds: PLAN_CATALOG.free_tier.includedSeconds,
        totalAllocatedSeconds: PLAN_CATALOG.free_tier.includedSeconds,
        totalConsumedSeconds: 0,
        subscriptionStatus: 'free_trial',
        maxConcurrentSessions: PLAN_CATALOG.free_tier.maxConcurrentSessions
      }
      this.quotas.set(userId, record)
    }
    return { ...record }
  }

  public async deductSeconds(
    userId: string,
    _sessionId: string,
    seconds: number,
    _channelMode: string
  ): Promise<DeductionResult> {
    const safeSec = Math.max(1, Math.floor(seconds))
    const current = await this.getOrCreateUserQuota(userId)
    const deducted = Math.min(current.remainingSeconds, safeSec)
    const nextRemaining = Math.max(0, current.remainingSeconds - safeSec)
    const nextConsumed = current.totalConsumedSeconds + deducted

    const updated: UserQuotaRecord = {
      ...current,
      remainingSeconds: nextRemaining,
      totalConsumedSeconds: nextConsumed,
      subscriptionStatus: nextRemaining <= 0 ? 'exhausted' : current.subscriptionStatus
    }
    this.quotas.set(userId, updated)

    return {
      remainingSeconds: nextRemaining,
      totalAllocatedSeconds: updated.totalAllocatedSeconds,
      totalConsumedSeconds: nextConsumed,
      exhausted: nextRemaining <= 0
    }
  }

  public async creditPurchase(params: {
    provider: 'microsoft_store' | 'paypal' | 'paddle'
    externalTransactionId: string
    userId: string
    planId: PlanId
    seconds: number
  }): Promise<CreditPurchaseResult> {
    const txKey = `${params.provider}:${params.externalTransactionId}`
    const current = await this.getOrCreateUserQuota(params.userId)

    if (this.processedTxKeys.has(txKey)) {
      return {
        credited: false,
        remainingSeconds: current.remainingSeconds,
        totalAllocatedSeconds: current.totalAllocatedSeconds
      }
    }

    this.processedTxKeys.add(txKey)
    const plan = PLAN_CATALOG[params.planId] || PLAN_CATALOG.pro_40h
    const updated: UserQuotaRecord = {
      ...current,
      planId: plan.id,
      remainingSeconds: current.remainingSeconds + params.seconds,
      totalAllocatedSeconds: current.totalAllocatedSeconds + params.seconds,
      subscriptionStatus: 'active',
      maxConcurrentSessions: plan.maxConcurrentSessions
    }
    this.quotas.set(params.userId, updated)

    return {
      credited: true,
      remainingSeconds: updated.remainingSeconds,
      totalAllocatedSeconds: updated.totalAllocatedSeconds
    }
  }

  public setTestQuotaSeconds(userId: string, remainingSeconds: number): void {
    const existing = this.quotas.get(userId)
    const safe = Math.max(0, Math.floor(remainingSeconds))
    this.quotas.set(userId, {
      userId,
      planId: existing?.planId ?? 'free_tier',
      remainingSeconds: safe,
      totalAllocatedSeconds: Math.max(existing?.totalAllocatedSeconds ?? 3600, safe),
      totalConsumedSeconds: existing?.totalConsumedSeconds ?? 0,
      subscriptionStatus: safe === 0 ? 'exhausted' : existing?.subscriptionStatus ?? 'free_trial',
      maxConcurrentSessions: existing?.maxConcurrentSessions ?? 1
    })
  }
}

/**
 * Production Supabase PostgreSQL Quota Store executing strictly with server-only service_role.
 */
export class SupabaseQuotaStore implements QuotaStore {
  private baseUrl: string
  private serviceRoleKey: string

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.baseUrl = supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = serviceRoleKey
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`
    }
  }

  public async getOrCreateUserQuota(userId: string): Promise<UserQuotaRecord> {
    const queryUrl = `${this.baseUrl}/rest/v1/user_quotas?user_id=eq.${encodeURIComponent(userId)}&select=*`
    const res = await fetch(queryUrl, { headers: this.headers() })
    if (!res.ok) {
      throw new Error(`Supabase quota query failed (${res.status})`)
    }

    const rows = (await res.json()) as Array<{
      user_id: string
      plan_id: PlanId
      remaining_seconds: number
      total_allocated_seconds: number
      total_consumed_seconds: number
      subscription_status: UserQuotaRecord['subscriptionStatus']
    }>

    if (rows.length > 0) {
      const row = rows[0]
      const plan = PLAN_CATALOG[row.plan_id] || PLAN_CATALOG.free_tier
      return {
        userId: row.user_id,
        planId: plan.id,
        remainingSeconds: row.remaining_seconds,
        totalAllocatedSeconds: row.total_allocated_seconds,
        totalConsumedSeconds: row.total_consumed_seconds,
        subscriptionStatus: row.subscription_status,
        maxConcurrentSessions: plan.maxConcurrentSessions
      }
    }

    // Safety provision if user existed before trigger installation
    const insertRes = await fetch(`${this.baseUrl}/rest/v1/user_quotas`, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        plan_id: 'free_tier',
        remaining_seconds: 3600,
        total_allocated_seconds: 3600,
        total_consumed_seconds: 0,
        subscription_status: 'free_trial'
      })
    })

    if (!insertRes.ok) {
      throw new Error(`Supabase quota provisioning failed (${insertRes.status})`)
    }

    return {
      userId,
      planId: 'free_tier',
      remainingSeconds: 3600,
      totalAllocatedSeconds: 3600,
      totalConsumedSeconds: 0,
      subscriptionStatus: 'free_trial',
      maxConcurrentSessions: 1
    }
  }

  public async deductSeconds(
    userId: string,
    sessionId: string,
    seconds: number,
    channelMode: string
  ): Promise<DeductionResult> {
    const res = await fetch(`${this.baseUrl}/rest/v1/rpc/deduct_usage_seconds`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        p_user_id: userId,
        p_session_id: sessionId,
        p_seconds: Math.max(1, Math.floor(seconds)),
        p_channel_mode: channelMode
      })
    })

    if (!res.ok) {
      throw new Error(`Supabase deduct_usage_seconds failed (${res.status})`)
    }

    const data = (await res.json()) as Array<{
      remaining_seconds: number
      total_allocated_seconds: number
      total_consumed_seconds: number
      exhausted: boolean
    }>
    const row = data[0]
    return {
      remainingSeconds: row?.remaining_seconds ?? 0,
      totalAllocatedSeconds: row?.total_allocated_seconds ?? 3600,
      totalConsumedSeconds: row?.total_consumed_seconds ?? 0,
      exhausted: row?.exhausted ?? true
    }
  }

  public async creditPurchase(params: {
    provider: 'microsoft_store' | 'paypal' | 'paddle'
    externalTransactionId: string
    userId: string
    planId: PlanId
    seconds: number
  }): Promise<CreditPurchaseResult> {
    const res = await fetch(`${this.baseUrl}/rest/v1/rpc/credit_billing_purchase`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        p_provider: params.provider,
        p_external_tx_id: params.externalTransactionId,
        p_user_id: params.userId,
        p_plan_id: params.planId,
        p_seconds: params.seconds
      })
    })

    if (!res.ok) {
      throw new Error(`Supabase credit_billing_purchase failed (${res.status})`)
    }

    const data = (await res.json()) as Array<{
      credited: boolean
      remaining_seconds: number
      total_allocated_seconds: number
    }>
    const row = data[0]
    return {
      credited: Boolean(row?.credited),
      remainingSeconds: row?.remaining_seconds ?? 0,
      totalAllocatedSeconds: row?.total_allocated_seconds ?? 0
    }
  }
}

export function createQuotaStore(config: GatewayConfig): QuotaStore {
  if (config.supabaseUrl && config.supabaseServiceRoleKey) {
    return new SupabaseQuotaStore(config.supabaseUrl, config.supabaseServiceRoleKey)
  }
  return new InMemoryQuotaStore()
}
