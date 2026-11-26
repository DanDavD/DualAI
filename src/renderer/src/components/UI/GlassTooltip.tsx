import React, { useEffect, useRef, useState } from 'react'
import { formatPlatformShortcut } from '../../utils/platform'

interface GlassTooltipProps {
  label: string
  description?: string
  shortcut?: string
  align?: 'left' | 'center' | 'right'
  placement?: 'bottom' | 'top'
  disabled?: boolean
  children: React.ReactNode
}

/**
 * Apple Liquid Glass Hover Tooltip.
 * Appears smoothly after a brief 220ms hover delay below or above controls so new users
 * instantly recognize each button's name, purpose, and shortcut without native browser lag.
 */
export const GlassTooltip: React.FC<GlassTooltipProps> = ({
  label,
  description,
  shortcut,
  align = 'center',
  placement = 'bottom',
  disabled = false,
  children
}) => {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    if (disabled) {
      clearTimer()
      setVisible(false)
    }
    return clearTimer
  }, [disabled])

  const handleMouseEnter = (): void => {
    if (disabled) return
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      setVisible(true)
    }, 220)
  }

  const handleMouseLeave = (): void => {
    clearTimer()
    setVisible(false)
  }

  const alignClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2'

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseLeave}
    >
      {children}

      {visible && !disabled && (
        <div
          role="tooltip"
          className={`glass-sheet pointer-events-none absolute z-[60] whitespace-nowrap rounded-xl px-2.5 py-1.5 text-left ${alignClass} ${
            placement === 'top'
              ? 'bottom-full mb-2 animate-glass-pop-up'
              : 'top-full mt-2 animate-glass-pop'
          }`}
        >
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-semibold tracking-tight text-white">{label}</span>
            {shortcut && (
              <kbd className="rounded-md border border-white/[0.12] bg-white/[0.07] px-1.5 py-0.5 font-mono text-[9px] text-white/70">
                {formatPlatformShortcut(shortcut)}
              </kbd>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-[10px] leading-tight text-white/55">{description}</p>
          )}
        </div>
      )}
    </div>
  )
}
