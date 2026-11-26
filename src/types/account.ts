/**
 * DUALAI - Zero-Trust SaaS Account, Quota & Billing Type Definitions
 * Strictly typed contracts between Electron Renderer and DualAI Cloud Gateway.
 */

export type PlanId = 'free_tier' | 'pro_40h' | 'pro_plus_70h' | 'unlimited'
export type CheckoutProvider = 'paypal' | 'paddle' | 'microsoft_store'

export interface CheckoutSessionResult {
  ok: boolean
  provider?: CheckoutProvider
  planId?: PlanId
  planName?: string
  monthlyPriceUsd?: number
  includedHours?: number
  checkoutSessionId?: string
  checkoutUrl?: string
  paddlePriceId?: string | null
  paddleProductId?: string | null
  msStoreProductId?: string | null
  storeUri?: string
  verificationEndpoint?: string
  error?: string
}

export interface BillingPlan {
  id: PlanId
  name: string
  description: string
  includedSeconds: number
  monthlyPriceUsd: number
  msStoreProductId: string | null
  paddlePriceId?: string | null
  paddleProductId?: string | null
  maxConcurrentSessions: number
  isUnlimitedFairUse?: boolean
}

export interface AccountQuota {
  userId: string
  planId: PlanId
  remainingSeconds: number
  totalAllocatedSeconds: number
  totalConsumedSeconds: number
  subscriptionStatus: 'free_trial' | 'active' | 'past_due' | 'exhausted' | 'canceled'
  maxConcurrentSessions: number
}

export interface AccountSubscriptionSummary {
  subscriptionId: string
  planId: PlanId
  status: 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled'
  scheduledChangeAction: 'cancel' | 'pause' | 'resume' | null
  scheduledChangeAt: string | null
  nextBilledAt: string | null
}

export interface AuthenticatedSession {
  accessToken: string
  refreshToken?: string
  expiresAtMs: number
  user: {
    userId: string
    email: string
    emailVerified?: boolean
    authMode: 'supabase' | 'local_dev'
  }
}

export const DEFAULT_SAAS_PLANS: BillingPlan[] = [
  {
    id: 'free_tier',
    name: 'Free Trial (1 Hour)',
    description: 'Automatic 1-hour real-time interpretation trial. All features included.',
    includedSeconds: 3600,
    monthlyPriceUsd: 0,
    msStoreProductId: null,
    maxConcurrentSessions: 1
  },
  {
    id: 'pro_40h',
    name: 'Pro (40 Hours)',
    description: '40 hours/month of unified multi-speaker live translation across 60+ languages.',
    includedSeconds: 144000,
    monthlyPriceUsd: 8.99,
    msStoreProductId: '9NBLGGH4DUAL40H',
    paddlePriceId: 'pri_01m8aw2f6rzakqqenynbztq74f',
    paddleProductId: 'pro_01m8avhb2vpt2qhxh6mfchxv7x',
    maxConcurrentSessions: 1
  },
  {
    id: 'pro_plus_70h',
    name: 'Pro+ (70 Hours)',
    description: '70 hours/month for active medical, legal, and business interpreters.',
    includedSeconds: 252000,
    monthlyPriceUsd: 14.99,
    msStoreProductId: '9NBLGGH4DUAL70H',
    paddlePriceId: 'pri_01m8avr4a5504btrxkscxhh75g',
    paddleProductId: 'pro_01m8avkskjcq996hev0sn86fsz',
    maxConcurrentSessions: 1
  },
  {
    id: 'unlimited',
    name: 'Unlimited',
    description: 'Unlimited monthly interpretation for full-time interpreters (single-user fair use).',
    includedSeconds: 576000,
    monthlyPriceUsd: 24.99,
    msStoreProductId: '9NBLGGH4DUALUNL',
    paddlePriceId: 'pri_01m8aw5w9mdx3bjm1q7pt3n3cz',
    paddleProductId: 'pro_01m8aw4pqg51pabbkxmkv0gypa',
    maxConcurrentSessions: 1,
    isUnlimitedFairUse: true
  }
]
