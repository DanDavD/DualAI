/**
 * DUALAI - Zero-Trust Authentication & Quota Service
 * Authenticates end users without exposing any upstream AI provider keys.
 * Persists user JWTs exclusively in OS Keychain / DPAPI via Electron safeStorage.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  AccountQuota,
  AuthenticatedSession,
  BillingPlan,
  DEFAULT_SAAS_PLANS
} from '../../../types/account'

const GATEWAY_BASE_URL = (
  import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:8787'
).replace(/\/$/, '')

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

let supabaseClient: SupabaseClient | null = null

function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false, // We persist encrypted via Electron safeStorage instead of localStorage
        autoRefreshToken: true
      }
    })
  }
  return supabaseClient
}

export function getGatewayHttpUrl(): string {
  return GATEWAY_BASE_URL
}

export function getGatewayWsUrl(): string {
  return GATEWAY_BASE_URL.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://')
}

export function isSupabaseAuthEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

export async function saveEncryptedSession(session: AuthenticatedSession): Promise<void> {
  if (typeof window !== 'undefined' && window.electronAPI?.storeEncryptedSession) {
    await window.electronAPI.storeEncryptedSession(JSON.stringify(session))
  }
}

export async function loadEncryptedSession(): Promise<AuthenticatedSession | null> {
  if (typeof window === 'undefined' || !window.electronAPI?.loadEncryptedSession) {
    return null
  }
  try {
    const raw = await window.electronAPI.loadEncryptedSession()
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthenticatedSession>
    if (
      !parsed.accessToken ||
      !parsed.user?.userId ||
      !parsed.user?.email ||
      typeof parsed.expiresAtMs !== 'number' ||
      parsed.expiresAtMs <= Date.now()
    ) {
      await clearEncryptedSession()
      return null
    }
    return parsed as AuthenticatedSession
  } catch {
    return null
  }
}

export async function clearEncryptedSession(): Promise<void> {
  if (typeof window !== 'undefined' && window.electronAPI?.clearEncryptedSession) {
    await window.electronAPI.clearEncryptedSession()
  }
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
  mode: 'signin' | 'signup'
): Promise<{ session: AuthenticatedSession; quota: AccountQuota; plans: BillingPlan[] }> {
  const sb = getSupabaseClient()

  if (sb) {
    const authRes =
      mode === 'signup'
        ? await sb.auth.signUp({ email, password })
        : await sb.auth.signInWithPassword({ email, password })

    if (authRes.error || !authRes.data.session || !authRes.data.user) {
      throw new Error(authRes.error?.message || 'Authentication failed. Check credentials or confirm your email.')
    }

    const session: AuthenticatedSession = {
      accessToken: authRes.data.session.access_token,
      expiresAtMs: (authRes.data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
      user: {
        userId: authRes.data.user.id,
        email: authRes.data.user.email || email,
        authMode: 'supabase'
      }
    }
    await saveEncryptedSession(session)
    const snapshot = await fetchAuthoritativeQuota(session.accessToken)
    return { session, quota: snapshot.quota, plans: snapshot.plans }
  }

  // Local development Zero-Trust Gateway sign-in (strictly disabled on production Gateway)
  const response = await fetch(`${GATEWAY_BASE_URL}/v1/auth/dev-signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(
      errBody.message ||
        `Unable to reach DualAI Cloud Gateway at ${GATEWAY_BASE_URL}. Start it with "pnpm run dev:gateway".`
    )
  }

  const data = (await response.json()) as {
    accessToken: string
    expiresAtMs: number
    user: AuthenticatedSession['user']
    quota: AccountQuota
  }

  const session: AuthenticatedSession = {
    accessToken: data.accessToken,
    expiresAtMs: data.expiresAtMs,
    user: data.user
  }

  await saveEncryptedSession(session)
  return { session, quota: data.quota, plans: DEFAULT_SAAS_PLANS }
}

export async function fetchAuthoritativeQuota(
  accessToken: string
): Promise<{ quota: AccountQuota; plans: BillingPlan[] }> {
  const response = await fetch(`${GATEWAY_BASE_URL}/v1/account/quota`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok) {
    throw new Error(`Quota authorization failed (${response.status}).`)
  }

  const data = (await response.json()) as {
    quota: AccountQuota
    plans?: BillingPlan[]
  }

  return {
    quota: data.quota,
    plans: data.plans && data.plans.length > 0 ? data.plans : DEFAULT_SAAS_PLANS
  }
}

export async function verifyMicrosoftStorePurchase(params: {
  accessToken: string
  storeIdKey: string
  productId: string
}): Promise<{ verified: boolean; remainingSeconds?: number; error?: string }> {
  const response = await fetch(`${GATEWAY_BASE_URL}/v1/billing/microsoft-store/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`
    },
    body: JSON.stringify({
      storeIdKey: params.storeIdKey,
      productId: params.productId
    })
  })

  const data = (await response.json().catch(() => ({}))) as {
    verified?: boolean
    remainingSeconds?: number
    error?: string
  }

  return {
    verified: Boolean(data.verified),
    remainingSeconds: data.remainingSeconds,
    error: data.error
  }
}
