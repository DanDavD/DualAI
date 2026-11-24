import React from 'react'
import { Clock } from 'lucide-react'
import { useSession } from '../../context/SessionContext'

export const QuotaGauge: React.FC = () => {
  const {
    quotaRemainingHours,
    quotaTotalHours,
    isGatewayAuthenticated,
    isQuotaExhausted,
    openAccountModal
  } = useSession()

  const safeTotal = Math.max(0.01, quotaTotalHours)
  const percentage = Math.min(100, Math.max(0, Math.round((quotaRemainingHours / safeTotal) * 100)))
  const totalMinutes = Math.max(0, Math.round(quotaRemainingHours * 60))
  const wholeHours = Math.floor(totalMinutes / 60)
  const remainingMinutes = totalMinutes % 60

  const labelText = !isGatewayAuthenticated
    ? '1h Free'
    : isQuotaExhausted
      ? '0m left'
      : wholeHours > 0
        ? `${wholeHours}h ${remainingMinutes}m`
        : `${remainingMinutes}m`

  return (
    <button
      type="button"
      onClick={openAccountModal}
      className={`flex h-8 items-center space-x-2.5 rounded border px-2.5 text-xs transition select-none ${
        isQuotaExhausted
          ? 'border-accent-crimson bg-accent-crimson/15 text-accent-crimson hover:bg-accent-crimson/25'
          : 'border-surface-border bg-surface-base text-text-secondary hover:border-accent-steel'
      }`}
      title={
        isGatewayAuthenticated
          ? `Server-Authoritative Plan Quota: ${quotaRemainingHours.toFixed(2)}h remaining of ${quotaTotalHours.toFixed(1)}h total. Click to manage plan.`
          : 'Sign in to activate your 1-Hour Free Tier on the DualAI Zero-Trust Gateway'
      }
    >
      <Clock
        className={`h-3 w-3 ${isQuotaExhausted ? 'text-accent-crimson' : 'text-text-muted'}`}
        strokeWidth={1.5}
      />
      <div className="flex flex-col justify-center text-left">
        <div className="flex items-center space-x-1.5 font-mono text-[11px] leading-tight text-text-primary">
          <span>{labelText}</span>
          <span className="text-[10px] text-text-muted">
            {!isGatewayAuthenticated ? 'Sign In' : isQuotaExhausted ? 'Upgrade' : 'left'}
          </span>
        </div>
        {/* Micro High-Density Progress Bar */}
        <div className="mt-0.5 h-1 w-20 overflow-hidden rounded-full bg-surface-border">
          <div
            className={`h-full transition-all duration-300 ${
              isQuotaExhausted ? 'bg-accent-crimson' : 'bg-accent-steel'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </button>
  )
}
