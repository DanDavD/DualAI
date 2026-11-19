import React from 'react'
import { Clock } from 'lucide-react'
import { useSession } from '../../context/SessionContext'

export const QuotaGauge: React.FC = () => {
  const { quotaRemainingHours, quotaTotalHours } = useSession()

  const percentage = Math.round((quotaRemainingHours / quotaTotalHours) * 100)
  const wholeHours = Math.floor(quotaRemainingHours)
  const remainingMinutes = Math.round((quotaRemainingHours - wholeHours) * 60)

  return (
    <div
      className="flex h-8 items-center space-x-2.5 rounded border border-surface-border bg-surface-base px-2.5 text-xs text-text-secondary select-none"
      title={`Plan Quota: ${quotaRemainingHours.toFixed(1)}h remaining of ${quotaTotalHours}h total`}
    >
      <Clock className="h-3 w-3 text-text-muted" strokeWidth={1.5} />
      <div className="flex flex-col justify-center">
        <div className="flex items-center space-x-1.5 font-mono text-[11px] leading-tight text-text-primary">
          <span>{wholeHours}h {remainingMinutes}m</span>
          <span className="text-[10px] text-text-muted">left</span>
        </div>
        {/* Micro High-Density Progress Bar */}
        <div className="mt-0.5 h-1 w-20 overflow-hidden rounded-full bg-surface-border">
          <div
            className="h-full bg-accent-steel transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  )
}
