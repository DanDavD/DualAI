/**
 * DUALAI - Zero-Trust Authentication, Silent JWT Refresh & Quota Service (CARD-17 Hardened)
 * Authenticates end users without exposing any upstream AI provider keys.
 * Persists user JWTs exclusively in OS Keychain / DPAPI via Electron safeStorage,
 * enforces verified email before free-tier activation, supports password reset,
 * silently rotates tokens prior to expiry, and revokes sessions server-side on Sign Out.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  AccountQuota,
  AccountSubscriptionSummary,
  AuthenticatedSession,
  BillingPlan,
  CheckoutProvider,
  CheckoutSessionResult,
  DEFAULT_SAAS_PLANS,
  PlanId
} from '../../../types/account'

const GATEWAY_BASE_URL = (
  (typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_GATEWAY_URL
    : undefined) || 'http://127.0.0.1:8787'
).replace(/\/$/, '')

const SUPABASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_SUPABASE_URL
    : undefined
  )?.trim() || ''
const SUPABASE_ANON_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_SUPABASE_ANON_KEY
    : undefined
  )?.trim() || ''

export const SILENT_REFRESH_LEAD_MS = 5 * 60 * 1000 // Refresh 5 minutes before JWT expiration
const MIN_REFRESH_DELAY_MS = 10_000

let supabaseClient: SupabaseClient | null = null
const memoryAuthStorage = new Map<string, string>()

function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        flowType: 'pkce',
        persistSession: false, // We persist encrypted via Electron safeStorage instead of localStorage
        autoRefreshToken: false, // Managed deterministically by DualAI silent refresh loop + Keychain sync
        detectSessionInUrl: false,
        storage: {
          getItem: (key: string) => memoryAuthStorage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            memoryAuthStorage.set(key, value)
          },
          removeItem: (key: string) => {
            memoryAuthStorage.delete(key)
          }
        }
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

/**
 * Pure deterministic scheduler computing how many milliseconds to wait before silently
 * refreshing a session JWT so 2-hour+ live calls never experience mid-session disconnects.
 */
export function computeSilentRefreshDelayMs(
  expiresAtMs: number,
  nowMs: number = Date.now()
): number {
  const remainingMs = expiresAtMs - nowMs
  const targetDelay = remainingMs - SILENT_REFRESH_LEAD_MS
  return Math.max(MIN_REFRESH_DELAY_MS, targetDelay)
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
      typeof parsed.expiresAtMs !== 'number'
    ) {
      await clearEncryptedSession()
      return null
    }
    if (parsed.expiresAtMs <= Date.now()) {
      // Attempt silent recovery via refresh token if available before discarding expired vault
      if (parsed.refreshToken) {
        const recovered = await refreshSessionToken(parsed as AuthenticatedSession)
        if (recovered) return recovered
      }
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

export type SignInResult =
  | {
      emailVerificationRequired: true
      message: string
    }
  | {
      emailVerificationRequired: false
      session: AuthenticatedSession
      quota: AccountQuota
      subscription: AccountSubscriptionSummary | null
      plans: BillingPlan[]
    }

export async function signInWithEmailPassword(
  email: string,
  password: string,
  mode: 'signin' | 'signup'
): Promise<SignInResult> {
  const sb = getSupabaseClient()

  if (sb) {
    const authRes =
      mode === 'signup'
        ? await sb.auth.signUp({ email, password })
        : await sb.auth.signInWithPassword({ email, password })

    if (authRes.error) {
      throw new Error(authRes.error.message || 'Authentication failed. Check your credentials.')
    }

    // Supabase signup when Email Confirmation is enforced returns user with null session
    if (mode === 'signup' && authRes.data.user && !authRes.data.session) {
      return {
        emailVerificationRequired: true,
        message:
          'Account created. Verify your email address from the confirmation link we sent before activating your 1-hour free tier.'
      }
    }

    if (!authRes.data.session || !authRes.data.user) {
      throw new Error('Authentication failed. Verify your email address and try again.')
    }

    const emailVerified = Boolean(
      authRes.data.user.email_confirmed_at || authRes.data.user.confirmed_at
    )

    if (!emailVerified) {
      await sb.auth.signOut().catch(() => undefined)
      return {
        emailVerificationRequired: true,
        message:
          'Your email address is not verified yet. Please confirm your email from your inbox before activating live interpretation.'
      }
    }

    const session: AuthenticatedSession = {
      accessToken: authRes.data.session.access_token,
      refreshToken: authRes.data.session.refresh_token,
      expiresAtMs:
        (authRes.data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
      user: {
        userId: authRes.data.user.id,
        email: authRes.data.user.email || email,
        emailVerified,
        authMode: 'supabase'
      }
    }
    await saveEncryptedSession(session)
    const snapshot = await fetchAuthoritativeQuota(session.accessToken)
    return {
      emailVerificationRequired: false,
      session,
      quota: snapshot.quota,
      subscription: snapshot.subscription,
      plans: snapshot.plans
    }
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
    user: {
      ...data.user,
      emailVerified: data.user.emailVerified !== false
    }
  }

  await saveEncryptedSession(session)
  return {
    emailVerificationRequired: false,
    session,
    quota: data.quota,
    subscription: null,
    plans: DEFAULT_SAAS_PLANS
  }
}

export type OAuthProvider = 'google' | 'apple'

let activeOAuthSessionId: string | null = null

export async function cancelActiveOAuthSignIn(): Promise<void> {
  if (activeOAuthSessionId && typeof window !== 'undefined' && window.electronAPI?.cancelOAuthCallback) {
    const id = activeOAuthSessionId
    activeOAuthSessionId = null
    await window.electronAPI.cancelOAuthCallback(id).catch(() => undefined)
  }
}

/**
 * Initiates native desktop OAuth (Google or Apple) via Supabase PKCE + RFC 8252 loopback.
 * Opens the system browser (required by Google & Apple security policies), captures the callback
 * on 127.0.0.1, exchanges the authorization code, and stores the JWT in OS Keychain.
 */
export async function signInWithOAuthProvider(provider: OAuthProvider): Promise<SignInResult> {
  const sb = getSupabaseClient()
  if (!sb) {
    throw new Error(
      `${provider === 'apple' ? 'Apple' : 'Google'} sign-in requires Supabase Auth configuration.`
    )
  }

  if (
    typeof window === 'undefined' ||
    !window.electronAPI?.prepareOAuthCallback ||
    !window.electronAPI?.launchOAuthAndWait
  ) {
    throw new Error('Desktop OAuth bridge is unavailable in this environment.')
  }

  const prepared = await window.electronAPI.prepareOAuthCallback()
  activeOAuthSessionId = prepared.sessionId

  try {
    const { data, error } = await sb.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: prepared.redirectUrl,
        skipBrowserRedirect: true
      }
    })

    if (error || !data?.url) {
      await window.electronAPI.cancelOAuthCallback(prepared.sessionId).catch(() => undefined)
      throw new Error(
        error?.message ||
          `Unable to start ${provider === 'apple' ? 'Apple' : 'Google'} sign-in right now.`
      )
    }

    const callback = await window.electronAPI.launchOAuthAndWait(prepared.sessionId, data.url)

    if (!callback.ok) {
      throw new Error(
        callback.error || `${provider === 'apple' ? 'Apple' : 'Google'} sign-in was not completed.`
      )
    }

    let sbSession: {
      access_token: string
      refresh_token?: string
      expires_at?: number
    } | null = null
    let sbUser: {
      id: string
      email?: string
      email_confirmed_at?: string | null
      confirmed_at?: string | null
    } | null = null

    if (callback.code) {
      const exchanged = await sb.auth.exchangeCodeForSession(callback.code)
      if (exchanged.error || !exchanged.data.session || !exchanged.data.user) {
        throw new Error(
          exchanged.error?.message || 'Unable to complete sign-in with authentication provider.'
        )
      }
      sbSession = exchanged.data.session
      sbUser = exchanged.data.user
    } else if (callback.accessToken) {
      const setRes = await sb.auth.setSession({
        access_token: callback.accessToken,
        refresh_token: callback.refreshToken || ''
      })
      if (setRes.error || !setRes.data.session || !setRes.data.user) {
        throw new Error(
          setRes.error?.message || 'Unable to validate session from authentication provider.'
        )
      }
      sbSession = setRes.data.session
      sbUser = setRes.data.user
    } else {
      throw new Error('Authentication provider did not return valid credentials.')
    }

    const session: AuthenticatedSession = {
      accessToken: sbSession.access_token,
      refreshToken: sbSession.refresh_token,
      expiresAtMs: (sbSession.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
      user: {
        userId: sbUser.id,
        email: sbUser.email || '',
        emailVerified: true,
        authMode: 'supabase'
      }
    }

    await saveEncryptedSession(session)
    const snapshot = await fetchAuthoritativeQuota(session.accessToken)
    return {
      emailVerificationRequired: false,
      session,
      quota: snapshot.quota,
      subscription: snapshot.subscription,
      plans: snapshot.plans
    }
  } finally {
    if (activeOAuthSessionId === prepared.sessionId) {
      activeOAuthSessionId = null
    }
  }
}

/**
 * Initiates Supabase password recovery flow with non-enumerating user feedback.
 */
export async function requestPasswordReset(email: string): Promise<string> {
  const cleanEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Enter a valid email address to reset your password.')
  }

  const sb = getSupabaseClient()
  if (sb) {
    const { error } = await sb.auth.resetPasswordForEmail(cleanEmail)
    if (error) {
      throw new Error(error.message || 'Unable to send password reset email right now.')
    }
  }

  return 'If an account exists for that email, a password reset link has been sent to your inbox.'
}

/**
 * Resends the Supabase email confirmation message for unverified signups.
 */
export async function resendVerificationEmail(email: string): Promise<string> {
  const cleanEmail = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Enter a valid email address first.')
  }

  const sb = getSupabaseClient()
  if (sb) {
    const { error } = await sb.auth.resend({
      type: 'signup',
      email: cleanEmail
    })
    if (error) {
      throw new Error(error.message || 'Unable to resend verification email right now.')
    }
  }

  return 'Verification email resent. Check your inbox and spam folder, then sign in.'
}

/**
 * Silently rotates the session JWT prior to expiration and updates the encrypted OS Keychain.
 * Returns null if refresh is unavailable so the caller can retain or prompt gracefully.
 */
export async function refreshSessionToken(
  currentSession: AuthenticatedSession
): Promise<AuthenticatedSession | null> {
  const sb = getSupabaseClient()

  if (sb && currentSession.user.authMode === 'supabase' && currentSession.refreshToken) {
    try {
      const { data, error } = await sb.auth.refreshSession({
        refresh_token: currentSession.refreshToken
      })
      if (error || !data.session || !data.user) {
        return null
      }
      const nextSession: AuthenticatedSession = {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token || currentSession.refreshToken,
        expiresAtMs:
          (data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
        user: {
          userId: data.user.id,
          email: data.user.email || currentSession.user.email,
          emailVerified: Boolean(data.user.email_confirmed_at || data.user.confirmed_at),
          authMode: 'supabase'
        }
      }
      await saveEncryptedSession(nextSession)
      return nextSession
    } catch {
      return null
    }
  }

  // Gateway-issued session silent refresh
  try {
    const response = await fetch(`${GATEWAY_BASE_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentSession.accessToken}`
      }
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      accessToken?: string
      expiresAtMs?: number
      user?: AuthenticatedSession['user']
    }
    if (!data.accessToken || typeof data.expiresAtMs !== 'number') {
      return null
    }
    const nextSession: AuthenticatedSession = {
      accessToken: data.accessToken,
      refreshToken: currentSession.refreshToken,
      expiresAtMs: data.expiresAtMs,
      user: data.user || currentSession.user
    }
    await saveEncryptedSession(nextSession)
    return nextSession
  } catch {
    return null
  }
}

/**
 * Revokes the active session server-side (Gateway denylist + Supabase logout) on Sign Out.
 */
export async function revokeServerSession(accessToken: string | null): Promise<void> {
  const tasks: Array<Promise<unknown>> = []

  if (accessToken) {
    tasks.push(
      fetch(`${GATEWAY_BASE_URL}/v1/auth/signout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }).catch(() => undefined)
    )
  }

  const sb = getSupabaseClient()
  if (sb) {
    tasks.push(sb.auth.signOut().catch(() => undefined))
  }

  await Promise.all(tasks)
}

export async function fetchAuthoritativeQuota(
  accessToken: string
): Promise<{
  quota: AccountQuota
  subscription: AccountSubscriptionSummary | null
  plans: BillingPlan[]
}> {
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
    subscription?: AccountSubscriptionSummary | null
    plans?: BillingPlan[]
  }

  return {
    quota: data.quota,
    subscription: data.subscription ?? null,
    plans: data.plans && data.plans.length > 0 ? data.plans : DEFAULT_SAAS_PLANS
  }
}

export async function cancelUserSubscription(
  accessToken: string
): Promise<{ ok: boolean; subscription?: AccountSubscriptionSummary; error?: string }> {
  const response = await fetch(`${GATEWAY_BASE_URL}/v1/billing/subscription/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  })

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    subscription?: AccountSubscriptionSummary
    error?: string
  }

  if (!response.ok || !data.ok) {
    return {
      ok: false,
      error: data.error || `Unable to cancel subscription (${response.status}).`
    }
  }

  return { ok: true, subscription: data.subscription }
}

export async function undoCancelUserSubscription(
  accessToken: string
): Promise<{ ok: boolean; subscription?: AccountSubscriptionSummary; error?: string }> {
  const response = await fetch(`${GATEWAY_BASE_URL}/v1/billing/subscription/undo-cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  })

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    subscription?: AccountSubscriptionSummary
    error?: string
  }

  if (!response.ok || !data.ok) {
    return {
      ok: false,
      error: data.error || `Unable to keep subscription (${response.status}).`
    }
  }

  return { ok: true, subscription: data.subscription }
}

export async function createBillingCheckoutSession(params: {
  accessToken: string
  planId: PlanId
  provider: CheckoutProvider
}): Promise<CheckoutSessionResult> {
  const response = await fetch(`${GATEWAY_BASE_URL}/v1/billing/checkout-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`
    },
    body: JSON.stringify({
      planId: params.planId,
      provider: params.provider
    })
  })

  const data = (await response.json().catch(() => ({}))) as CheckoutSessionResult
  if (!response.ok || !data.ok) {
    return {
      ok: false,
      error: data.error || `Unable to create checkout session (${response.status}).`
    }
  }
  return data
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

/**
 * Requests an authenticated self-service Paddle Customer Portal session URL from the Cloud Gateway.
 * Server resolves customer_id from authenticated session (never client-trusted).
 */
export async function requestCustomerPortalSession(
  accessToken: string
): Promise<{ ok: boolean; portalUrl?: string; error?: string }> {
  const response = await fetch(`${GATEWAY_BASE_URL}/v1/billing/customer-portal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }
  })

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    portalUrl?: string
    error?: string
  }

  if (!response.ok || !data.ok || !data.portalUrl) {
    return {
      ok: false,
      error: data.error || `Unable to open customer portal (${response.status}).`
    }
  }

  return { ok: true, portalUrl: data.portalUrl }
}
