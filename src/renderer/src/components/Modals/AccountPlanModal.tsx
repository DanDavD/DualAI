/**
 * DUALAI - Apple-Style Account & Horizontal Plans Modal
 * Separates Sign In / Account Profile cleanly from the 4-column left-to-right Plans view,
 * using calm consumer-friendly language with zero technical jargon while keeping 100%
 * of verified-email auth, password reset, quota sync, and Paddle/PayPal/Microsoft Store checkout.
 */

import React, { useEffect, useState } from 'react'
import { initializePaddle, type Paddle } from '@paddle/paddle-js'
import {
  X,
  LogOut,
  RefreshCw,
  Check,
  MailCheck,
  ExternalLink,
  ArrowRight,
  Sparkles,
  CreditCard,
  Mail,
  Lock,
  Eye,
  EyeOff
} from 'lucide-react'
import { CheckoutProvider, CheckoutSessionResult, PlanId } from '../../../../types/account'
import { useSession } from '../../context/SessionContext'
import {
  cancelActiveOAuthSignIn,
  isSupabaseAuthEnabled,
  OAuthProvider,
  requestCustomerPortalSession
} from '../../services/gatewayAuthService'
import { GlassSegmentedControl } from '../UI/GlassSegmentedControl'

const GoogleGlyph: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
    />
    <path
      fill="#34A853"
      d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.565 24 12.255 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 0 0 0 10.76l3.98-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.69 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
    />
  </svg>
)

type AccountAuthView = 'signin' | 'signup' | 'reset'
type ModalSection = 'account' | 'plans'

function getInitials(email?: string): string {
  if (!email) return ''
  const namePart = email.split('@')[0] || ''
  const parts = namePart.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return namePart.slice(0, 2).toUpperCase()
}

export const AccountPlanModal: React.FC = () => {
  const {
    isAccountModalOpen,
    closeAccountModal,
    authSession,
    accountQuota,
    accountSubscription,
    availablePlans,
    isQuotaExhausted,
    signInAccount,
    signInWithOAuthAccount,
    signOutAccount,
    requestPasswordResetAccount,
    resendVerificationEmailAccount,
    refreshAccountQuota,
    cancelSubscriptionAccount,
    undoCancelSubscriptionAccount,
    startPlanCheckout,
    verifyMsStoreReceipt
  } = useSession()

  const [section, setSection] = useState<ModalSection>('account')
  const [authMode, setAuthMode] = useState<AccountAuthView>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null)
  const [checkoutProvider, setCheckoutProvider] = useState<CheckoutProvider>('paddle')
  const [activeCheckout, setActiveCheckout] = useState<CheckoutSessionResult | null>(null)
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false)
  const [msStoreIdKey, setMsStoreIdKey] = useState('')
  const [isVerifyingStoreReceipt, setIsVerifyingStoreReceipt] = useState(false)
  const [isOpeningPortal, setIsOpeningPortal] = useState(false)
  const [isRefreshingAccount, setIsRefreshingAccount] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [isUpdatingSubscription, setIsUpdatingSubscription] = useState(false)
  const [paddleInstance, setPaddleInstance] = useState<Paddle | null>(null)

  useEffect(() => {
    if (!isAccountModalOpen) {
      setShowCancelConfirm(false)
      return
    }
    setErrorMessage(null)
    setStatusNotice(null)
    setShowCancelConfirm(false)
    if (authSession?.accessToken) {
      void refreshAccountQuota({ syncBilling: false }).catch(() => undefined)
    }
  }, [isAccountModalOpen, authSession?.accessToken, refreshAccountQuota])

  useEffect(() => {
    const clientToken = import.meta.env.VITE_PADDLE_CLIENT_TOKEN
    const paddleEnv = (import.meta.env.VITE_PADDLE_ENV || 'production') as 'sandbox' | 'production'
    if (!clientToken) return

    initializePaddle({
      token: clientToken,
      environment: paddleEnv,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') {
          void refreshAccountQuota()
          setCheckoutNotice('Payment completed. Your hours have been activated.')
        }
      }
    })
      .then((paddle) => {
        if (paddle) setPaddleInstance(paddle)
      })
      .catch((err) => {
        console.warn('Paddle overlay initialization error:', err)
      })
  }, [refreshAccountQuota])

  useEffect(() => {
    if (!window.electronAPI?.onCheckoutClosed) return
    return window.electronAPI.onCheckoutClosed((completed) => {
      void refreshAccountQuota()
      setCheckoutNotice(
        completed
          ? 'Payment completed. Your hours are being activated.'
          : 'Payment window closed.'
      )
    })
  }, [refreshAccountQuota])

  if (!isAccountModalOpen) return null

  const supabaseEnabled = isSupabaseAuthEnabled()
  const isHydratingQuota = Boolean(authSession && !accountQuota)
  const remainingSec = accountQuota?.remainingSeconds ?? 0
  const allocatedSec = Math.max(1, accountQuota?.totalAllocatedSeconds ?? 1)
  const remainingMinutes = Math.floor(remainingSec / 60)
  const remainingHours = Math.floor(remainingMinutes / 60)
  const modMinutes = remainingMinutes % 60
  const remainingPct = isHydratingQuota
    ? 0
    : Math.min(100, Math.max(0, Math.round((remainingSec / allocatedSec) * 100)))
  const isUnverifiedSession = Boolean(authSession && authSession.user.emailVerified === false)
  const initials = getInitials(authSession?.user?.email)

  const switchAuthView = (nextMode: AccountAuthView) => {
    setAuthMode(nextMode)
    setErrorMessage(null)
    setStatusNotice(null)
  }

  const handleCloseModal = () => {
    if (oauthLoading) {
      void cancelActiveOAuthSignIn()
      setOauthLoading(null)
    }
    closeAccountModal()
  }

  const handleOAuthSignIn = async (provider: OAuthProvider) => {
    setErrorMessage(null)
    setStatusNotice(null)
    setOauthLoading(provider)
    try {
      const outcome = await signInWithOAuthAccount(provider)
      if (outcome.emailVerificationRequired && outcome.message) {
        setStatusNotice(outcome.message)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to complete sign-in.'
      if (!/canceled|superseded/i.test(msg)) {
        setErrorMessage(msg)
      }
    } finally {
      setOauthLoading(null)
    }
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
          outcome.message || 'Check your inbox to verify your email and activate your free hour.'
        )
      } else {
        setPendingVerificationEmail(null)
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to sign in right now.')
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

  const handleSelectPlan = async (planId: PlanId, planName: string) => {
    if (planId === 'free_tier') return
    setCheckoutError(null)
    setCheckoutNotice(null)

    if (!authSession) {
      setSection('account')
      setErrorMessage('Sign in or create a free account first to choose a plan.')
      return
    }
    if (isUnverifiedSession) {
      setSection('account')
      setErrorMessage('Please verify your email address before upgrading.')
      return
    }

    setIsCheckoutLoading(true)
    try {
      const result = await startPlanCheckout(planId, checkoutProvider)
      setActiveCheckout(result)
      if (!result.ok) {
        setCheckoutError(result.error || `Unable to start checkout for ${planName}.`)
        return
      }
      if (checkoutProvider === 'microsoft_store') {
        if (result.storeUri) {
          window.open(result.storeUri, '_blank')
        }
        setCheckoutNotice(`Complete your purchase for ${planName} in Microsoft Store, then verify below.`)
      } else if (result.checkoutUrl) {
        // Open Paddle checkout in an in-app modal window (never leaves the app)
        const opened = window.electronAPI?.openCheckoutWindow
          ? await window.electronAPI.openCheckoutWindow(result.checkoutUrl)
          : false
        if (!opened) {
          window.open(result.checkoutUrl, '_blank')
        }
        setCheckoutNotice(`Secure payment window opened for ${planName}.`)
      } else if (checkoutProvider === 'paddle' && paddleInstance && result.paddlePriceId) {
        paddleInstance.Checkout.open({
          settings: {
            displayMode: 'overlay',
            theme: 'dark',
            locale: 'en'
          },
          items: [
            {
              priceId: result.paddlePriceId,
              quantity: 1
            }
          ],
          customer: authSession?.user?.email ? { email: authSession.user.email } : undefined,
          customData: {
            userId: authSession.user.userId,
            planId: planId
          }
        })
        setCheckoutNotice(`Payment window opened for ${planName}.`)
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout could not be started.')
    } finally {
      setIsCheckoutLoading(false)
    }
  }

  const handleVerifyStoreReceipt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeCheckout?.planId || !msStoreIdKey.trim()) return
    setCheckoutError(null)
    setCheckoutNotice(null)
    setIsVerifyingStoreReceipt(true)
    try {
      const res = await verifyMsStoreReceipt(activeCheckout.planId, msStoreIdKey.trim())
      if (res.verified) {
        setMsStoreIdKey('')
        setActiveCheckout(null)
        setCheckoutNotice('Purchase confirmed. Your hours have been added to your account.')
      } else {
        setCheckoutError(res.error || 'Could not verify Microsoft Store receipt.')
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Receipt verification failed.')
    } finally {
      setIsVerifyingStoreReceipt(false)
    }
  }

  const handleOpenCustomerPortal = async () => {
    if (!authSession?.accessToken) {
      setErrorMessage('Please sign in first to access your billing portal.')
      return
    }
    setIsOpeningPortal(true)
    setErrorMessage(null)
    setCheckoutError(null)
    try {
      const res = await requestCustomerPortalSession(authSession.accessToken)
      if (res.ok && res.portalUrl) {
        window.open(res.portalUrl, '_blank')
        // Reconcile billing state automatically when the user returns from Paddle Customer Portal
        const syncOnReturn = () => {
          window.removeEventListener('focus', syncOnReturn)
          void refreshAccountQuota({ syncBilling: true }).catch(() => undefined)
        }
        window.addEventListener('focus', syncOnReturn, { once: true })
      } else {
        setErrorMessage(
          res.error ||
            'No billing history yet. Once you choose a paid plan, your invoices and payment settings will appear here.'
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to open Manage Billing right now.'
      setErrorMessage(msg)
    } finally {
      setIsOpeningPortal(false)
    }
  }

  const handleManualRefreshAccount = async () => {
    if (isRefreshingAccount) return
    setIsRefreshingAccount(true)
    setErrorMessage(null)
    try {
      await refreshAccountQuota({ syncBilling: true })
    } catch {
      setErrorMessage('Unable to refresh your account right now. Please try again.')
    } finally {
      setIsRefreshingAccount(false)
    }
  }

  const formatShortDate = (iso?: string | null): string => {
    if (!iso) return 'the end of your billing period'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return 'the end of your billing period'
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const handleConfirmCancelSubscription = async () => {
    setErrorMessage(null)
    setStatusNotice(null)
    setIsUpdatingSubscription(true)
    try {
      const res = await cancelSubscriptionAccount()
      if (res.ok) {
        setShowCancelConfirm(false)
        const endIso = res.subscription?.scheduledChangeAt ?? accountSubscription?.scheduledChangeAt
        const formattedEnd = endIso ? formatShortDate(endIso) : null
        if (res.alreadyScheduled && formattedEnd) {
          setStatusNotice(
            `Your subscription is already scheduled to end on ${formattedEnd}. You keep full access and all remaining hours until then.`
          )
        } else if (formattedEnd) {
          setStatusNotice(
            `Your subscription is scheduled to end on ${formattedEnd}. You keep full access and all remaining hours until then.`
          )
        } else {
          setStatusNotice(
            res.message ||
              'Subscription scheduled to cancel at the end of your billing period. You keep access and remaining hours until then.'
          )
        }
      } else {
        setShowCancelConfirm(false)
        setErrorMessage(res.error || 'Could not cancel subscription right now.')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not cancel subscription.')
    } finally {
      setIsUpdatingSubscription(false)
    }
  }

  const handleUndoCancelSubscription = async () => {
    setErrorMessage(null)
    setStatusNotice(null)
    setIsUpdatingSubscription(true)
    try {
      const res = await undoCancelSubscriptionAccount()
      if (res.ok) {
        const renewIso = res.subscription?.nextBilledAt
        const formattedRenew = renewIso ? formatShortDate(renewIso) : null
        setStatusNotice(
          res.alreadyActive
            ? 'Your subscription is already active and will continue as normal.'
            : formattedRenew
              ? `Cancellation undone. Your subscription remains active and renews on ${formattedRenew}.`
              : res.message || 'Cancellation undone. Your subscription will continue as normal.'
        )
      } else {
        setErrorMessage(res.error || 'Could not keep subscription right now.')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not keep subscription.')
    } finally {
      setIsUpdatingSubscription(false)
    }
  }

  const hasActiveSubscription = Boolean(
    accountSubscription && accountSubscription.status !== 'canceled'
  )
  const isScheduledToCancel = Boolean(
    hasActiveSubscription && accountSubscription?.scheduledChangeAction === 'cancel'
  )
  const isScheduledToPause = Boolean(
    hasActiveSubscription && accountSubscription?.scheduledChangeAction === 'pause'
  )
  const isPausedSubscription = Boolean(accountSubscription?.status === 'paused')
  const isPastDueSubscription = Boolean(accountSubscription?.status === 'past_due')
  const formattedScheduledDate = accountSubscription?.scheduledChangeAt
    ? formatShortDate(accountSubscription.scheduledChangeAt)
    : null
  const formattedNextBilledDate = accountSubscription?.nextBilledAt
    ? formatShortDate(accountSubscription.nextBilledAt)
    : null

  const isPlansView = section === 'plans'

  return (
    <div
      className="animate-glass-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-label="DualAI Account and Plans"
    >
      <div
        key={section}
        className={`glass-sheet animate-glass-modal flex max-h-[90vh] w-full flex-col overflow-hidden rounded-[26px] text-xs text-text-primary ${
          isPlansView ? 'max-w-[960px]' : 'max-w-[460px]'
        }`}
      >
        {/* Clean Top Navigation Bar */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
          <GlassSegmentedControl<ModalSection>
            ariaLabel="Account or Plans view"
            value={section}
            onChange={(next) => {
              setSection(next)
              setErrorMessage(null)
              setCheckoutError(null)
            }}
            options={[
              { id: 'account', label: authSession ? 'Account' : 'Sign In' },
              { id: 'plans', label: 'Plans & Pricing' }
            ]}
          />

          <button
            type="button"
            onClick={handleCloseModal}
            aria-label="Close Account Modal"
            className="glass-control-hover flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-white/60 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Status Alerts */}
          {isQuotaExhausted && (
            <div
              role="alert"
              className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-accent-crimson/40 bg-accent-crimson/12 px-4 py-3 text-xs text-accent-crimson"
            >
              <span>You have used all your available hours for this cycle.</span>
              {!isPlansView && (
                <button
                  type="button"
                  onClick={() => setSection('plans')}
                  className="shrink-0 rounded-full bg-accent-crimson px-3 py-1 text-[11px] font-semibold text-white"
                >
                  View Plans
                </button>
              )}
            </div>
          )}

          {isUnverifiedSession && authSession && (
            <div
              role="alert"
              className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent-amber/40 bg-accent-amber/12 px-4 py-3 text-xs text-accent-amber"
            >
              <span className="flex items-center space-x-2">
                <MailCheck className="h-4 w-4 shrink-0" />
                <span>Verify your email to activate your free hour.</span>
              </span>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleResendVerification(authSession.user.email)}
                className="glass-control-hover rounded-full border border-accent-amber/50 bg-white/[0.08] px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                Resend Verification
              </button>
            </div>
          )}

          {/* ================================================================
           * VIEW 1: CLEAN APPLE-STYLE SIGN IN / ACCOUNT PROFILE
           * ================================================================ */}
          {!isPlansView ? (
            !authSession ? (
              <div className="space-y-5 py-1">
                {/* Clean Editorial Heading (Zero Logo Clutter) */}
                <div className="text-center space-y-1">
                  <h2 className="text-[20px] font-semibold tracking-tight text-white">
                    {authMode === 'signup'
                      ? 'Create your account'
                      : authMode === 'reset'
                        ? 'Reset your password'
                        : 'Sign in to DualAI'}
                  </h2>
                  <p className="text-xs text-white/50">
                    {authMode === 'signup'
                      ? 'Includes 1 free hour of live translation right away.'
                      : authMode === 'reset'
                        ? 'We will send a password reset link to your inbox.'
                        : 'Sync your translation hours and settings automatically.'}
                  </p>
                </div>

                {/* Top Liquid Glass Sign In / Sign Up Switcher */}
                {authMode !== 'reset' && (
                  <GlassSegmentedControl<'signin' | 'signup'>
                    ariaLabel="Sign in or sign up"
                    value={authMode}
                    onChange={switchAuthView}
                    size="md"
                    fullWidth
                    options={[
                      { id: 'signin', label: 'Sign In' },
                      { id: 'signup', label: 'Sign Up' }
                    ]}
                  />
                )}

                {/* Native Google OAuth Provider */}
                {authMode !== 'reset' && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      disabled={isSubmitting || Boolean(oauthLoading)}
                      onClick={() => void handleOAuthSignIn('google')}
                      className="glass-control-hover flex h-11 w-full items-center justify-center space-x-2.5 rounded-full border border-white/[0.12] bg-white/[0.06] text-[13px] font-medium tracking-tight text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:border-white/[0.18] hover:bg-white/[0.1] disabled:opacity-55"
                    >
                      <GoogleGlyph className="h-4 w-4 shrink-0" />
                      <span>
                        {oauthLoading === 'google'
                          ? 'Continue in browser...'
                          : authMode === 'signup'
                            ? 'Sign up with Google'
                            : 'Sign in with Google'}
                      </span>
                    </button>

                    {oauthLoading && (
                      <div className="flex items-center justify-center pt-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            void cancelActiveOAuthSignIn()
                            setOauthLoading(null)
                          }}
                          className="text-[11px] font-medium text-white/45 hover:text-white transition"
                        >
                          Cancel browser sign-in
                        </button>
                      </div>
                    )}

                    {/* Hairline Separator */}
                    <div className="flex items-center gap-3 pt-1.5">
                      <div className="h-px flex-1 bg-white/[0.08]" />
                      <span className="text-[11px] font-medium text-white/40">or</span>
                      <div className="h-px flex-1 bg-white/[0.08]" />
                    </div>
                  </div>
                )}

                {/* Email & Password Form */}
                <form onSubmit={(e) => void handleSubmitAuth(e)} className="space-y-3">
                  <div className="space-y-2.5">
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
                        strokeWidth={1.75}
                      />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        aria-label="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email"
                        className="h-11 w-full rounded-2xl border border-white/[0.1] bg-white/[0.055] pl-10 pr-3.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-accent-steel/80 focus:bg-white/[0.09] transition"
                      />
                    </div>

                    {authMode !== 'reset' && (
                      <div className="relative">
                        <Lock
                          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40"
                          strokeWidth={1.75}
                        />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required={supabaseEnabled}
                          autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                          aria-label="Password"
                          minLength={supabaseEnabled ? 8 : undefined}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={authMode === 'signup' ? 'Password (min. 8 characters)' : 'Password'}
                          className="h-11 w-full rounded-2xl border border-white/[0.1] bg-white/[0.055] pl-10 pr-10 text-sm text-white placeholder:text-white/35 outline-none focus:border-accent-steel/80 focus:bg-white/[0.09] transition"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full text-white/40 hover:bg-white/[0.08] hover:text-white/80 transition"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                          ) : (
                            <Eye className="h-4 w-4" strokeWidth={1.75} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {authMode === 'signin' && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => switchAuthView('reset')}
                        className="text-[11px] font-medium text-white/50 hover:text-white transition"
                      >
                        Forgot password?
                      </button>
                    </div>
                  )}

                  {statusNotice && (
                    <div
                      role="status"
                      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent-emerald/40 bg-accent-emerald/12 px-3.5 py-2.5 text-xs text-accent-emerald"
                    >
                      <span>{statusNotice}</span>
                      {pendingVerificationEmail && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => void handleResendVerification(pendingVerificationEmail)}
                          className="rounded-full bg-white/[0.1] px-3 py-1 text-[11px] font-medium text-white"
                        >
                          Resend
                        </button>
                      )}
                    </div>
                  )}

                  {errorMessage && (
                    <p
                      role="alert"
                      className="rounded-2xl border border-accent-crimson/40 bg-accent-crimson/12 px-3.5 py-2.5 text-xs text-accent-crimson"
                    >
                      {errorMessage}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || Boolean(oauthLoading)}
                    className="glass-cta-start h-11 w-full rounded-full text-sm font-semibold disabled:opacity-45"
                  >
                    {isSubmitting
                      ? 'Please wait...'
                      : authMode === 'signup'
                        ? 'Create Free Account'
                        : authMode === 'reset'
                          ? 'Send Reset Link'
                          : 'Sign In'}
                  </button>
                </form>

                {/* Subtle Bottom Navigation */}
                <div className="flex items-center justify-between border-t border-white/[0.07] pt-3.5 text-xs">
                  {authMode === 'reset' ? (
                    <button
                      type="button"
                      onClick={() => switchAuthView('signin')}
                      className="text-white/50 hover:text-white transition"
                    >
                      Back to Sign In
                    </button>
                  ) : (
                    <span className="text-[11px] text-white/40">
                      {authMode === 'signup' ? '1-hour free trial included' : 'Zero-data retention'}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setSection('plans')}
                    className="flex items-center space-x-1 font-medium text-accent-steel hover:text-blue-400 transition"
                  >
                    <span>See plans</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              /* Signed-In Clean Account Profile */
              <div className="space-y-5 py-1">
                <div className="flex flex-col items-center text-center space-y-2">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-steel/22 border border-accent-steel/45 text-lg font-semibold text-white">
                    {initials || 'U'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{authSession.user.email}</p>
                    <div className="mt-1 flex items-center justify-center gap-2 text-xs text-white/50">
                      <span>
                        Plan:{' '}
                        <span className="font-medium text-white/85">
                          {isHydratingQuota
                            ? 'Syncing...'
                            : availablePlans.find((p) => p.id === accountQuota?.planId)?.name ||
                              'Free Trial (1 Hour)'}
                        </span>
                      </span>
                      {hasActiveSubscription && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            isScheduledToCancel || isScheduledToPause || isPausedSubscription
                              ? 'bg-accent-amber/18 text-accent-amber border border-accent-amber/35'
                              : isPastDueSubscription
                                ? 'bg-accent-crimson/18 text-accent-crimson border border-accent-crimson/35'
                                : 'bg-accent-emerald/18 text-accent-emerald border border-accent-emerald/35'
                          }`}
                        >
                          {isScheduledToCancel
                            ? formattedScheduledDate
                              ? `Cancels ${formattedScheduledDate}`
                              : 'Cancels end of cycle'
                            : isScheduledToPause
                              ? formattedScheduledDate
                                ? `Pauses ${formattedScheduledDate}`
                                : 'Pause scheduled'
                              : isPausedSubscription
                                ? 'Paused'
                                : isPastDueSubscription
                                  ? 'Past Due'
                                  : 'Active'}
                        </span>
                      )}
                      {accountSubscription?.status === 'canceled' && (
                        <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-medium text-white/55">
                          Canceled
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Authoritative Subscription Lifecycle Banner (from DB / Paddle) */}
                {isScheduledToCancel && (
                  <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-accent-amber/35 bg-accent-amber/10 px-3.5 py-3 text-xs text-accent-amber">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-white">
                        {formattedScheduledDate
                          ? `Subscription ends on ${formattedScheduledDate}`
                          : 'Subscription scheduled to end'}
                      </p>
                      <p className="text-[11px] text-accent-amber/90">
                        {formattedScheduledDate
                          ? `Your remaining hours stay available until ${formattedScheduledDate}. You will not be billed again.`
                          : 'Your remaining hours stay available through the end of your billing period.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isUpdatingSubscription}
                      onClick={() => void handleUndoCancelSubscription()}
                      className="glass-control-hover shrink-0 rounded-full border border-accent-amber/45 bg-white/[0.1] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      {isUpdatingSubscription ? 'Saving...' : 'Keep Subscription'}
                    </button>
                  </div>
                )}

                {isScheduledToPause && (
                  <div className="rounded-2xl border border-accent-amber/35 bg-accent-amber/10 px-3.5 py-2.5 text-xs text-accent-amber">
                    {formattedScheduledDate
                      ? `Subscription scheduled to pause on ${formattedScheduledDate}. Manage or change this anytime in Manage Billing.`
                      : 'Subscription scheduled to pause. Manage or change this anytime in Manage Billing.'}
                  </div>
                )}

                {isPausedSubscription && (
                  <div className="rounded-2xl border border-accent-amber/30 bg-accent-amber/10 px-3.5 py-2.5 text-xs text-accent-amber">
                    Your subscription is paused. Resume anytime in Manage Billing.
                  </div>
                )}

                {isPastDueSubscription && (
                  <div className="rounded-2xl border border-accent-crimson/40 bg-accent-crimson/12 px-3.5 py-2.5 text-xs text-accent-crimson">
                    Your last payment could not be processed. Update your payment method in Manage
                    Billing to keep your plan active.
                  </div>
                )}

                {/* Clean Remaining Time Card */}
                <div className="glass-grouped-card rounded-2xl p-4 space-y-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-white/55">Time remaining</span>
                    <span className="text-base font-semibold tabular-nums text-white">
                      {isHydratingQuota
                        ? '--'
                        : remainingHours > 0
                          ? `${remainingHours}h ${modMinutes}m`
                          : `${modMinutes}m`}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.1]">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        remainingPct <= 10 ? 'bg-accent-crimson' : 'bg-accent-steel'
                      }`}
                      style={{ width: `${remainingPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-white/40">
                    <span>
                      {isScheduledToCancel && formattedScheduledDate
                        ? `${remainingPct}% left · Ends ${formattedScheduledDate}`
                        : formattedNextBilledDate && !isScheduledToCancel
                          ? `${remainingPct}% left · Renews ${formattedNextBilledDate}`
                          : `${remainingPct}% left in current cycle`}
                    </span>
                    <button
                      type="button"
                      disabled={isRefreshingAccount}
                      onClick={() => void handleManualRefreshAccount()}
                      className="flex items-center space-x-1 text-white/65 hover:text-white transition disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${isRefreshingAccount ? 'animate-spin' : ''}`}
                      />
                      <span>{isRefreshingAccount ? 'Syncing...' : 'Refresh'}</span>
                    </button>
                  </div>
                </div>

                {statusNotice && (
                  <p
                    role="status"
                    className="rounded-2xl border border-accent-emerald/40 bg-accent-emerald/12 px-3.5 py-2.5 text-xs text-accent-emerald"
                  >
                    {statusNotice}
                  </p>
                )}

                {errorMessage && (
                  <p
                    role="alert"
                    className="rounded-2xl border border-accent-crimson/40 bg-accent-crimson/12 px-3.5 py-2.5 text-xs text-accent-crimson"
                  >
                    {errorMessage}
                  </p>
                )}

                {/* Inline Liquid Glass Cancel Confirmation Card */}
                {showCancelConfirm && hasActiveSubscription && !isScheduledToCancel && (
                  <div className="glass-grouped-card animate-glass-pop rounded-2xl border border-accent-crimson/35 p-3.5 space-y-3 text-xs">
                    <div className="space-y-1">
                      <p className="font-semibold text-white">Cancel subscription?</p>
                      <p className="text-[11px] leading-relaxed text-white/60">
                        Your plan stays active until the end of your current billing period and you
                        keep all remaining hours. You will not be billed again.
                      </p>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={isUpdatingSubscription}
                        onClick={() => setShowCancelConfirm(false)}
                        className="glass-control-hover rounded-full border border-white/[0.1] bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-medium text-white/80 hover:text-white"
                      >
                        Keep Plan
                      </button>
                      <button
                        type="button"
                        disabled={isUpdatingSubscription}
                        onClick={() => void handleConfirmCancelSubscription()}
                        className="glass-cta-stop rounded-full px-3.5 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                      >
                        {isUpdatingSubscription ? 'Canceling...' : 'Confirm Cancellation'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => setSection('plans')}
                    className="glass-cta-start flex h-10 w-full items-center justify-center space-x-2 rounded-full text-sm font-semibold"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>Upgrade or Add Hours</span>
                  </button>

                  <button
                    type="button"
                    disabled={isOpeningPortal}
                    onClick={() => void handleOpenCustomerPortal()}
                    className="glass-control-hover flex h-9 w-full items-center justify-center space-x-1.5 rounded-full border border-white/[0.09] bg-white/[0.04] text-xs font-medium text-white/80 hover:text-white disabled:opacity-50"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>{isOpeningPortal ? 'Opening Portal...' : 'Manage Billing & Invoices'}</span>
                  </button>

                  {hasActiveSubscription && !isScheduledToCancel && !showCancelConfirm && (
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMessage(null)
                        setStatusNotice(null)
                        setShowCancelConfirm(true)
                      }}
                      className="glass-control-hover flex h-9 w-full items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-xs font-medium text-white/55 hover:border-accent-crimson/35 hover:text-accent-crimson"
                    >
                      Cancel Subscription
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void signOutAccount()}
                    className="glass-control-hover flex h-9 w-full items-center justify-center space-x-1.5 rounded-full border border-white/[0.09] bg-white/[0.04] text-xs font-medium text-white/65 hover:text-accent-crimson"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            /* ================================================================
             * VIEW 2: 4 HORIZONTAL PLAN CARDS LEFT-TO-RIGHT
             * ================================================================ */
            <div className="space-y-5">
              {/* Plans Header + Subtle Payment Method Switcher */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-white">
                    Simple, transparent plans
                  </h2>
                  <p className="mt-0.5 text-xs text-white/50">
                    Every plan includes 60+ languages, speaker detection, and the floating teleprompter.
                  </p>
                </div>

                <GlassSegmentedControl<CheckoutProvider>
                  ariaLabel="Payment method"
                  value={checkoutProvider}
                  onChange={(next) => {
                    setCheckoutProvider(next)
                    setActiveCheckout(null)
                    setCheckoutError(null)
                  }}
                  options={[
                    { id: 'paddle', label: 'Card / Paddle' },
                    { id: 'paypal', label: 'PayPal' },
                    { id: 'microsoft_store', label: 'Microsoft Store' }
                  ]}
                />
              </div>

              {/* 4 Horizontal Cards Side-by-Side (Left -> Right) */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {availablePlans.map((plan) => {
                  const isCurrent = accountQuota?.planId === plan.id
                  const isPopular = plan.id === 'pro_plus_70h'
                  const hours = Math.round(plan.includedSeconds / 3600)
                  const cleanName =
                    plan.id === 'free_tier'
                      ? 'Free'
                      : plan.id === 'pro_40h'
                        ? 'Pro'
                        : plan.id === 'pro_plus_70h'
                          ? 'Pro+'
                          : 'Unlimited'

                  return (
                    <div
                      key={plan.id}
                      className={`relative flex flex-col justify-between rounded-[22px] border p-4 transition-all duration-200 ${
                        isPopular
                          ? 'border-accent-steel/60 bg-accent-steel/12 shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.22),0_12px_32px_-8px_rgba(10,132,255,0.28)]'
                          : isCurrent
                            ? 'border-accent-emerald/50 bg-accent-emerald/10'
                            : 'glass-grouped-card hover:bg-white/[0.07]'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-white">{cleanName}</span>
                          {isPopular ? (
                            <span className="rounded-full bg-accent-steel px-2 py-0.5 text-[10px] font-semibold text-white">
                              Popular
                            </span>
                          ) : isCurrent ? (
                            <span className="rounded-full bg-accent-emerald/20 px-2 py-0.5 text-[10px] font-medium text-accent-emerald">
                              Current
                            </span>
                          ) : null}
                        </div>

                        {/* Big Crisp Price */}
                        <div className="flex items-baseline space-x-1">
                          <span className="text-2xl font-bold tracking-tight tabular-nums text-white">
                            {plan.monthlyPriceUsd === 0
                              ? '$0'
                              : `$${plan.monthlyPriceUsd.toFixed(2)}`}
                          </span>
                          {plan.monthlyPriceUsd > 0 && (
                            <span className="text-[11px] text-white/45">/ month</span>
                          )}
                        </div>

                        <div className="h-px w-full bg-white/[0.08]" />

                        {/* Concise Scannable Highlights */}
                        <ul className="space-y-2 text-[11px] text-white/75">
                          <li className="flex items-center space-x-2">
                            <Check className="h-3.5 w-3.5 shrink-0 text-accent-emerald" strokeWidth={2.2} />
                            <span className="font-medium text-white">
                              {plan.isUnlimitedFairUse
                                ? 'Unlimited hours*'
                                : plan.id === 'free_tier'
                                  ? '1 hour included'
                                  : `${hours} hours / month`}
                            </span>
                          </li>
                          <li className="flex items-center space-x-2">
                            <Check className="h-3.5 w-3.5 shrink-0 text-accent-emerald" strokeWidth={2.2} />
                            <span>60+ live languages</span>
                          </li>
                          <li className="flex items-center space-x-2">
                            <Check className="h-3.5 w-3.5 shrink-0 text-accent-emerald" strokeWidth={2.2} />
                            <span>Multi-speaker & HUD</span>
                          </li>
                        </ul>
                      </div>

                      <div className="pt-5">
                        {plan.id === 'free_tier' ? (
                          <div className="flex h-9 w-full items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.04] text-[11px] font-medium text-white/50">
                            {isCurrent ? 'Active Plan' : 'Included Free'}
                          </div>
                        ) : hasActiveSubscription &&
                          !isScheduledToCancel &&
                          accountSubscription?.planId === plan.id ? (
                          <div className="flex h-9 w-full items-center justify-center rounded-full border border-accent-emerald/35 bg-accent-emerald/12 text-[11px] font-semibold text-accent-emerald">
                            Current Plan
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isCheckoutLoading}
                            onClick={() => void handleSelectPlan(plan.id, cleanName)}
                            className={`flex h-9 w-full items-center justify-center space-x-1.5 rounded-full text-xs font-semibold disabled:opacity-50 ${
                              isPopular
                                ? 'glass-cta-start'
                                : 'glass-control-hover border border-white/[0.14] bg-white/[0.1] text-white hover:bg-white/[0.18]'
                            }`}
                          >
                            <span>{`Choose ${cleanName}`}</span>
                            {checkoutProvider !== 'microsoft_store' && (
                              <ExternalLink className="h-3 w-3 opacity-70" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Feedback Banners */}
              {checkoutNotice && (
                <div
                  role="status"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent-emerald/40 bg-accent-emerald/12 px-4 py-3 text-xs text-accent-emerald"
                >
                  <span>{checkoutNotice}</span>
                  <button
                    type="button"
                    onClick={() => void refreshAccountQuota()}
                    className="rounded-full bg-white/[0.1] px-3 py-1 text-[11px] font-medium text-white"
                  >
                    Refresh Balance
                  </button>
                </div>
              )}

              {checkoutError && (
                <p
                  role="alert"
                  className="rounded-2xl border border-accent-crimson/40 bg-accent-crimson/12 px-4 py-3 text-xs text-accent-crimson"
                >
                  {checkoutError}
                </p>
              )}

              {/* Microsoft Store Receipt Verification (Shown only when active) */}
              {activeCheckout?.ok && checkoutProvider === 'microsoft_store' && (
                <form
                  onSubmit={(e) => void handleVerifyStoreReceipt(e)}
                  className="glass-grouped-card rounded-2xl p-4 space-y-3"
                >
                  <p className="text-xs font-medium text-white">
                    Verify your Microsoft Store purchase
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      required
                      value={msStoreIdKey}
                      onChange={(e) => setMsStoreIdKey(e.target.value)}
                      placeholder="Paste Microsoft Store receipt ID"
                      className="h-9 flex-1 rounded-full border border-white/[0.1] bg-white/[0.06] px-4 text-xs text-white placeholder:text-white/35 outline-none focus:border-accent-steel"
                    />
                    <button
                      type="submit"
                      disabled={isVerifyingStoreReceipt}
                      className="glass-cta-start h-9 rounded-full px-5 text-xs font-semibold disabled:opacity-50"
                    >
                      {isVerifyingStoreReceipt ? 'Verifying...' : 'Confirm Purchase'}
                    </button>
                  </div>
                </form>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-white/40 pt-2">
                <span>* Unlimited covers fair-use single-user interpretation.</span>
                <span className="opacity-40">•</span>
                <a
                  href="https://dualai.universalaisync.com/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white/80 transition-colors underline"
                >
                  Terms
                </a>
                <span className="opacity-40">•</span>
                <a
                  href="https://dualai.universalaisync.com/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white/80 transition-colors underline"
                >
                  Privacy
                </a>
                <span className="opacity-40">•</span>
                <a
                  href="https://dualai.universalaisync.com/refunds"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-white/80 transition-colors underline"
                >
                  Refunds
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
