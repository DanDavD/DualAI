import React from 'react'

interface AcousticPulseProps {
  active: boolean
  tone?: 'emerald' | 'steel' | 'amber' | 'crimson' | 'neutral' | 'muted'
}

/**
 * Minimalist 3-bar GPU-animated live acoustic indicator.
 * Gives immediate calm visual feedback that speech is being captured or translated.
 */
export const AcousticPulse: React.FC<AcousticPulseProps> = ({ active, tone = 'emerald' }) => {
  const colorClass =
    tone === 'emerald'
      ? 'bg-accent-emerald'
      : tone === 'steel'
        ? 'bg-accent-steel'
        : tone === 'amber'
          ? 'bg-accent-amber'
          : tone === 'crimson'
            ? 'bg-accent-crimson'
            : 'bg-white/40'

  if (!active) {
    return <span className={`h-2 w-2 rounded-full ${colorClass} transition-colors duration-200`} />
  }

  return (
    <span className="inline-flex h-3 items-center space-x-[2px]" aria-hidden="true">
      <span className={`h-2.5 w-[2px] rounded-full ${colorClass} acoustic-bar-1`} />
      <span className={`h-3 w-[2px] rounded-full ${colorClass} acoustic-bar-2`} />
      <span className={`h-2 w-[2px] rounded-full ${colorClass} acoustic-bar-3`} />
    </span>
  )
}
