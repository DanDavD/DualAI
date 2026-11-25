/**
 * DUALAI - Zero-Trust Account, Verified Email Gate, Password Recovery & Plan Upgrade Modal (CARD-17)
 * Allows end users to sign in with zero API key configuration, enforces verified email before
 * activating the 1-hour Free Tier, supports password reset and email verification resend,
 * and supports Microsoft Store (Windows MSIX) and PayPal/Paddle (macOS/Web) upgrades.
 */

import React, { useState } from 'react'
import {
  X,
  ShieldCheck,
  Lock,
  LogOut,
  RefreshCw,
  Check,
  CreditCard,
  KeyRound,
  MailCheck
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { isSupabaseAuthEnabled } from '../../services/gatewayAuthService'

type AccountAuthView = 'signin' | 'signup' | 'reset'

export const AccountPlanModal: React.FC = () => {
  const {
    isAccountModalOpen,
    closeAccountModal,
    authSession,
    accountQuota,
    availablePlans,
    isQuotaExhausted,
    signInAccount,
    signOutAccount,
    requestPasswordResetAccount,
    resendVerificationEmailAccount,
    refreshAccountQuota
  } = useSession()

  const [authMode, setAuthMode] = useState<AccountAuthView>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null)
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null)

  if (!isAccountModalOpen) return null

  const supabaseEnabled = isSupabaseAuthEnabled()
  const remainingSec = accountQuota?.remainingSeconds ?? 3600
  const allocatedSec = Math.max(1, accountQuota?.totalAllocatedSeconds ?? 3600)
  const remainingMinutes = Math.floor(remainingSec / 60)
  const remainingHours = Math.floor(remainingMinutes / 60)
  const modMinutes = remainingMinutes % 60
  const remainingPct = Math.min(100, Math.max(0, Math.round((remainingSec / allocatedSec) * 100)))
  const isUnverifiedSession = Boolean(authSession && authSession.user.emailVerified === false)

  const switchAuthView = (nextMode: AccountAuthView) => {
    setAuthMode(nextMode)
    setErrorMessage(null)
    setStatusNotice(null)
  }

  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setStatusNotice(null)
    setIsSubmitting(true)
    const trimmedEmail = email.trim()

    try {
      if (authMode === 'reset') {
        const message = await requestPasswordResetAccount(trimmedEmail)
        setStatusNotice(message)
        return
      }

      const outcome = await signInAccount(trimmedEmail, password || 'local-dev-pass', authMode)
      setPassword('')
      if (outcome.emailVerificationRequired) {
        setPendingVerificationEmail(trimmedEmail)
        setStatusNotice(
          outcome.message ||
            'Please verify your email address from your inbox before activating the 1-hour free tier.'
        )
      } else {
        setPendingVerificationEmail(null)
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to authenticate.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResendVerification = async (targetEmail: string) => {
    setErrorMessage(null)
    setStatusNotice(null)
    setIsSubmitting(true)
    try {
      const msg = await resendVerificationEmailAccount(targetEmail)
      setStatusNotice(msg)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to resend verification email.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSelectPlan = (planName: string, msProductId: string | null) => {
    if (msProductId) {
      setCheckoutNotice(
        `Plan "${planName}" selected. On Windows MSIX, Microsoft Store checkout verifies Product ID ${msProductId} directly with the DualAI Gateway; on macOS/Web, PayPal/Paddle checkout credits hours automatically.`
      )
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="DualAI Account and Subscription Plans"
    >
      <div className="flex max-h-[88vh] w-full max-w-[780px] flex-col overflow-hidden rounded-lg border border-surface-border bg-surface-panel text-xs text-text-primary shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-border bg-surface-base px-5 py-3.5">
          <div className="flex items-center space-x-2.5">
            <ShieldCheck className="h-4 w-4 text-accent-emerald" strokeWidth={1.75} />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-text-primary">
                DualAI Account & Interpretation Quota
              </h2>
              <p className="font-mono text-[10px] text-text-muted">
                Zero-Trust Cloud Gateway | Verified Email Auth | Silent JWT Refresh | OS Keychain Vault
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeAccountModal}
            aria-label="Close Account Modal"
            className="rounded p-1 text-text-muted hover:bg-surface-active hover:text-text-primary transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isQuotaExhausted && (
            <div
              role="alert"
              className="rounded border border-accent-crimson/50 bg-accent-crimson/10 p-3 font-mono text-[11px] text-accent-crimson"
            >
              Your available interpretation hours have reached 0m. Select a plan below to add hours
              and resume live translation immediately.
            </div>
          )}

          {isUnverifiedSession && authSession && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-accent-amber/50 bg-accent-amber/10 p-3 font-mono text-[11px] text-accent-amber"
            >
              <span className="flex items-center space-x-2">
                <MailCheck className="h-4 w-4 shrink-0" />
                <span>
                  Email verification required before activating live free-tier streaming.
                </span>
              </span>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleResendVerification(authSession.user.email)}
                className="rounded border border-accent-amber/60 bg-surface-base px-2.5 py-1 text-[10px] font-bold text-text-primary hover:bg-surface-active disabled:opacity-50 transition"
              >
                Resend Verification
              </button>
            </div>
          )}

          {!authSession ? (
            <form
              onSubmit={(e) => void handleSubmitAuth(e)}
              className="rounded-lg border border-surface-border bg-surface-base p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    {authMode === 'signup'
                      ? 'Create Account - 1 Hour Free Included'
                      : authMode === 'reset'
                        ? 'Reset Account Password'
                        : 'Sign In to DualAI Cloud Gateway'}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {authMode === 'reset'
                      ? 'Enter your registered email address to receive a secure password reset link.'
                      : 'Verified email required to unlock your 60-minute free trial. No API keys needed.'}
                  </p>
                </div>
                <div className="flex rounded border border-surface-border bg-surface-panel p-0.5 font-mono text-[10px]">
                  <button
                    type="button"
                    onClick={() => switchAuthView('signin')}
                    className={`rounded px-2.5 py-1 transition ${
                      authMode === 'signin'
                        ? 'bg-accent-steel text-white font-bold'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => switchAuthView('signup')}
                    className={`rounded px-2.5 py-1 transition ${
                      authMode === 'signup'
                        ? 'bg-accent-steel text-white font-bold'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Sign Up (1h Free)
                  </button>
                </div>
              </div>

              <div
                className={`grid grid-cols-1 gap-3 ${authMode === 'reset' ? '' : 'sm:grid-cols-2'}`}
              >
                <label className="space-y-1">
                  <span className="block font-mono text-[10px] uppercase text-text-secondary">
                    Email Address
                  </span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="interpreter@clinic.org"
                    className="w-full rounded border border-surface-border bg-surface-panel px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent-steel"
                  />
                </label>

                {authMode !== 'reset' && (
                  <label className="space-y-1">
                    <span className="block font-mono text-[10px] uppercase text-text-secondary">
                      Password {!supabaseEnabled && '(Optional in Local Dev)'}
                    </span>
                    <input
                      type="password"
                      required={supabaseEnabled}
                      minLength={supabaseEnabled ? 8 : undefined}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={supabaseEnabled ? 'Minimum 8 characters' : 'Local Gateway Dev Mode'}
                      className="w-full rounded border border-surface-border bg-surface-panel px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent-steel"
                    />
                  </label>
                )}
              </div>

              {statusNotice && (
                <div
                  role="status"
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-accent-emerald/40 bg-accent-emerald/10 px-3 py-2 font-mono text-[11px] text-accent-emerald"
                >
                  <span>{statusNotice}</span>
                  {pendingVerificationEmail && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleResendVerification(pendingVerificationEmail)}
                      className="rounded border border-accent-emerald/50 bg-surface-base px-2.5 py-1 text-[10px] font-bold text-text-primary hover:bg-surface-active disabled:opacity-50 transition"
                    >
                      Resend Verification Email
                    </button>
                  )}
                </div>
              )}

              {errorMessage && (
                <p
                  role="alert"
                  className="rounded border border-accent-crimson/40 bg-accent-crimson/10 px-3 py-2 font-mono text-[11px] text-accent-crimson"
                >
                  {errorMessage}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-col space-y-1">
                  <span className="flex items-center space-x-1.5 font-mono text-[10px] text-text-muted">
                    <Lock className="h-3 w-3 text-accent-emerald" />
                    <span>
                      Token encrypted via Electron safeStorage (Keychain / Windows DPAPI)
                    </span>
                  </span>
                  {authMode === 'signin' ? (
                    <button
                      type="button"
                      onClick={() => switchAuthView('reset')}
                      className="w-fit font-mono text-[10px] text-accent-steel underline underline-offset-4 hover:text-blue-400 transition"
                    >
                      Forgot password?
                    </button>
                  ) : authMode === 'reset' ? (
                    <button
                      type="button"
                      onClick={() => switchAuthView('signin')}
                      className="w-fit font-mono text-[10px] text-text-secondary underline underline-offset-4 hover:text-text-primary transition"
                    >
                      Back to Sign In
                    </button>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded bg-accent-steel px-4 py-2 font-mono text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  {isSubmitting
                    ? 'PROCESSING...'
                    : authMode === 'signup'
                      ? 'START 1-HOUR FREE TIER'
                      : authMode === 'reset'
                        ? 'SEND RESET LINK'
                        : 'SIGN IN'}
                </button>
              </div>
            </form>
          ) : (
            <div className="rounded-lg border border-surface-border bg-surface-base p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <KeyRound className="h-4 w-4 text-accent-emerald" />
                  <div>
                    <p className="font-mono text-xs font-semibold text-text-primary">
                      {authSession.user.email}
                    </p>
                    <p className="font-mono text-[10px] text-text-muted">
                      Plan: {accountQuota?.planId.toUpperCase() || 'FREE_TIER'} | Status:{' '}
                      {accountQuota?.subscriptionStatus.toUpperCase() || 'FREE_TRIAL'} | Email:{' '}
                      {isUnverifiedSession ? 'UNVERIFIED' : 'VERIFIED'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => void refreshAccountQuota()}
                    className="flex items-center space-x-1 rounded border border-surface-border bg-surface-panel px-2.5 py-1.5 font-mono text-[11px] text-text-secondary hover:text-text-primary transition"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Sync Quota</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void signOutAccount()}
                    className="flex items-center space-x-1 rounded border border-accent-crimson/40 bg-accent-crimson/10 px-2.5 py-1.5 font-mono text-[11px] text-accent-crimson hover:bg-accent-crimson/20 transition"
                  >
                    <LogOut className="h-3 w-3" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-text-secondary">Server-Authoritative Balance</span>
                  <span className="font-bold text-text-primary">
                    {remainingHours > 0 ? `${remainingHours}h ${modMinutes}m` : `${modMinutes}m`}{' '}
                    remaining ({remainingPct}%)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-border">
                  <div
                    className={`h-full transition-all duration-300 ${
                      remainingPct <= 10 ? 'bg-accent-crimson' : 'bg-accent-steel'
                    }`}
                    style={{ width: `${remainingPct}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Tiered Plans Matrix (Microsoft Store MSIX + PayPal/Paddle Honduras-Compatible) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-text-secondary">
                Available Interpretation Hour Plans
              </h3>
              <span className="flex items-center space-x-1 font-mono text-[10px] text-text-muted">
                <CreditCard className="h-3 w-3" />
                <span>Microsoft Store (Windows) & PayPal / Paddle (Global)</span>
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {availablePlans.map((plan) => {
                const isCurrent = accountQuota?.planId === plan.id
                const hours = Math.round(plan.includedSeconds / 3600)
                return (
                  <div
                    key={plan.id}
                    className={`flex flex-col justify-between rounded-lg border p-4 ${
                      isCurrent
                        ? 'border-accent-emerald bg-accent-emerald/5'
                        : 'border-surface-border bg-surface-base'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-text-primary">{plan.name}</span>
                        <span className="font-mono text-xs font-bold text-accent-steel">
                          {plan.monthlyPriceUsd === 0 ? 'FREE' : `$${plan.monthlyPriceUsd.toFixed(2)}/mo`}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-text-muted">
                        {plan.description}
                      </p>
                      <div className="flex items-center space-x-3 pt-1 font-mono text-[10px] text-text-secondary">
                        <span className="flex items-center space-x-1">
                          <Check className="h-3 w-3 text-accent-emerald" />
                          <span>
                            {plan.isUnlimitedFairUse ? 'Unlimited hours/mo*' : `${hours}h / month`}
                          </span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <Check className="h-3 w-3 text-accent-emerald" />
                          <span>Multi-speaker + 60+ languages</span>
                        </span>
                      </div>
                    </div>

                    <div className="pt-3">
                      {plan.id === 'free_tier' ? (
                        <span className="block w-full rounded border border-surface-border bg-surface-panel py-1.5 text-center font-mono text-[10px] text-text-muted">
                          {isCurrent ? 'ACTIVE FREE TIER' : 'INCLUDED ON SIGNUP'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelectPlan(plan.name, plan.msStoreProductId)}
                          className="w-full rounded bg-accent-steel py-1.5 font-mono text-[11px] font-bold text-white hover:bg-blue-700 transition"
                        >
                          {isCurrent ? 'ADD MORE HOURS' : 'UPGRADE VIA STORE / PAYPAL'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {checkoutNotice && (
              <div className="rounded border border-accent-steel/40 bg-accent-steel/10 p-3 font-mono text-[11px] text-text-primary">
                {checkoutNotice}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
