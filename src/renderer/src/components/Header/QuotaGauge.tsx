import React from 'react'
import { User } from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { GlassTooltip } from '../UI/GlassTooltip'

function getInitials(email?: string): string {
  if (!email) return ''
  const namePart = email.split('@')[0] || ''
  const segments = namePart.split(/[._-]+/).filter(Boolean)
  if (segments.length >= 2) {
    return `${segments[0][0]}${segments[1][0]}`.toUpperCase()
  }
  return namePart.slice(0, 2).toUpperCase()
}

/**
 * Apple-style Account Avatar with Circular Quota Progress Ring.
 * Displays remaining hours elegantly without visual clutter.
 */
export const QuotaGauge: React.FC = () => {
  const {
    accountQuota,
    quotaRemainingHours,
    quotaTotalHours,
    isGatewayAuthenticated,
    isQuotaExhausted,
    authSession,
    openAccountModal
  } = useSession()

  const isHydratingQuota = isGatewayAuthenticated && !accountQuota
  const safeTotal = Math.max(0.01, quotaTotalHours)
  const percentage = isHydratingQuota
    ? 0
    : Math.min(100, Math.max(0, Math.round((quotaRemainingHours / safeTotal) * 100)))
  const totalMinutes = Math.max(0, Math.round(quotaRemainingHours * 60))
  const wholeHours = Math.floor(totalMinutes / 60)
  const remainingMinutes = totalMinutes % 60

  const labelText = !isGatewayAuthenticated
    ? 'Sign In'
    : isHydratingQuota
      ? '--'
      : isQuotaExhausted
        ? '0m'
        : wholeHours > 0
          ? `${wholeHours}h ${remainingMinutes}m`
          : `${remainingMinutes}m`

  const initials = getInitials(authSession?.user?.email)
  const radius = 11
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (percentage / 100) * circumference

  return (
    <div data-tour-id="account" className="inline-flex">
      <GlassTooltip
        label={isGatewayAuthenticated ? 'Account & Hours' : 'Sign In'}
        description={
          isGatewayAuthenticated && authSession
            ? `${authSession.user.email} · ${labelText} remaining`
            : 'Start your 1-hour free trial & view plans'
        }
        align="right"
      >
        <button
          type="button"
          data-toolbar-item="true"
          onClick={openAccountModal}
          aria-label={
            isGatewayAuthenticated && authSession
              ? `Account ${authSession.user.email}, ${labelText} remaining`
              : 'Sign in for 1-Hour Free Tier'
          }
          className={`glass-control-hover flex h-7 items-center space-x-1.5 rounded-full pl-1 pr-2 text-[11px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 ${
            isQuotaExhausted ? 'text-accent-crimson' : 'text-white/85 hover:text-white'
          }`}
        >
          {/* Circular Avatar with Live SVG Quota Progress Ring */}
          <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
            <svg className="absolute inset-0 h-6 w-6 -rotate-90" viewBox="0 0 26 26" aria-hidden="true">
              <circle
                cx="13"
                cy="13"
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="1.75"
              />
              {isGatewayAuthenticated && (
                <circle
                  cx="13"
                  cy="13"
                  r={radius}
                  fill="none"
                  stroke={isQuotaExhausted ? '#ff453a' : '#0a84ff'}
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  style={{ transition: 'stroke-dashoffset 400ms var(--ease-apple-spring)' }}
                />
              )}
            </svg>
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white/[0.12] text-[9px] font-semibold tracking-tight text-white">
              {isGatewayAuthenticated && initials ? (
                initials
              ) : (
                <User className="h-3 w-3 text-white/75" strokeWidth={1.75} />
              )}
            </span>
          </span>

          <span className="hidden lg:inline tabular-nums text-[11px] whitespace-nowrap">{labelText}</span>
        </button>
      </GlassTooltip>
    </div>
  )
}
