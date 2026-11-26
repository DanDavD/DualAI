import React from 'react'

interface AppleSwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel: string
  disabled?: boolean
}

/**
 * Authentic macOS / iOS Liquid Glass Toggle Switch.
 * Uses Apple System Green (#30D158) when active with spring-physics knob glide.
 */
export const AppleSwitch: React.FC<AppleSwitchProps> = ({
  checked,
  onChange,
  ariaLabel,
  disabled = false
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 disabled:opacity-40 ${
        checked
          ? 'bg-accent-emerald shadow-[inset_0_1px_1px_rgba(0,0,0,0.18)]'
          : 'bg-white/[0.16] border border-white/[0.08]'
      }`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.45)]"
        style={{
          transform: checked ? 'translateX(16px)' : 'translateX(0px)',
          transition: 'transform 240ms var(--ease-apple-bounce)'
        }}
      />
    </button>
  )
}
