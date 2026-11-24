/**
 * DUALAI - Zero-Trust SaaS Account, Quota & Billing Type Definitions
 * Strictly typed contracts between Electron Renderer and DualAI Cloud Gateway.
 */

export type PlanId = 'free_tier' | 'starter_10h' | 'pro_40h' | 'enterprise_100h'

export interface BillingPlan {
  id: PlanId
  name: string
  description: string
  includedSeconds: number
  monthlyPriceUsd: number
  msStoreProductId: string | null
  maxConcurrentSessions: number
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

export interface AuthenticatedSession {
  accessToken: string
  expiresAtMs: number
  user: {
    userId: string
    email: string
    authMode: 'supabase' | 'local_dev'
  }
}

export const DEFAULT_SAAS_PLANS: BillingPlan[] = [
  {
    id: 'free_tier',
    name: 'Free Starter (1 Hour)',
    description: 'Automatic 1-hour real-time interpretation trial. Zero API keys required.',
    includedSeconds: 3600,
    monthlyPriceUsd: 0,
    msStoreProductId: null,
    maxConcurrentSessions: 1
  },
  {
    id: 'starter_10h',
    name: 'Interpreter Starter (10 Hours)',
    description: '10 hours of live STT + specialized domain translation via Microsoft Store or PayPal.',
    includedSeconds: 36000,
    monthlyPriceUsd: 14.99,
    msStoreProductId: '9NBLGGH4DUAL10H',
    maxConcurrentSessions: 1
  },
  {
    id: 'pro_40h',
    name: 'Interpreter Pro (40 Hours)',
    description: '40 hours for medical, legal, and corporate interpretation with 2 concurrent channels.',
    includedSeconds: 144000,
    monthlyPriceUsd: 39.99,
    msStoreProductId: '9NBLGGH4DUAL40H',
    maxConcurrentSessions: 2
  },
  {
    id: 'enterprise_100h',
    name: 'Enterprise Studio (100 Hours)',
    description: '100 hours monthly quota with priority routing and custom terminology glossaries.',
    includedSeconds: 360000,
    monthlyPriceUsd: 79.99,
    msStoreProductId: '9NBLGGH4DUAL100H',
    maxConcurrentSessions: 3
  }
]
