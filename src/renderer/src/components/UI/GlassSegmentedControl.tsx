import React, { useLayoutEffect, useRef, useState } from 'react'

export interface SegmentedOption<T extends string> {
  id: T
  label: string
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>
  title?: string
}

interface GlassSegmentedControlProps<T extends string> {
  ariaLabel: string
  value: T
  options: Array<SegmentedOption<T>>
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  fullWidth?: boolean
}

/**
 * Apple Liquid Glass Sliding Segmented Control.
 * Measures active button geometry and glides a frosted pill indicator smoothly
 * using GPU-composited translateX with Apple spring physics.
 */
export function GlassSegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  size = 'sm',
  fullWidth = false
}: GlassSegmentedControlProps<T>): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [thumbStyle, setThumbStyle] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false
  })

  const activeIndex = Math.max(
    0,
    options.findIndex((opt) => opt.id === value)
  )

  useLayoutEffect(() => {
    const updateThumb = (): void => {
      const btn = buttonRefs.current[activeIndex]
      if (!btn) return
      setThumbStyle({
        left: btn.offsetLeft,
        width: btn.offsetWidth,
        ready: true
      })
    }

    updateThumb()

    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateThumb)
    observer.observe(container)
    return () => observer.disconnect()
  }, [activeIndex, options.length])

  const handleKeyDown = (e: React.KeyboardEvent, idx: number): void => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = (idx + 1) % options.length
      onChange(options[next].id)
      buttonRefs.current[next]?.focus()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = (idx - 1 + options.length) % options.length
      onChange(options[prev].id)
      buttonRefs.current[prev]?.focus()
    }
  }

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={`relative inline-flex items-center shrink-0 rounded-full bg-white/[0.06] p-0.5 border border-white/[0.08] select-none ${
        fullWidth ? 'w-full' : ''
      }`}
    >
      {/* GPU-Accelerated Sliding Liquid Glass Thumb */}
      {thumbStyle.ready && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-full bg-white/[0.15] border border-white/[0.14] shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.22),0_2px_8px_rgba(0,0,0,0.3)]"
          style={{
            width: `${thumbStyle.width}px`,
            transform: `translateX(${thumbStyle.left - 2}px)`,
            transition: 'transform 260ms var(--ease-apple-spring), width 260ms var(--ease-apple-spring)'
          }}
        />
      )}

      {options.map((opt, idx) => {
        const isActive = opt.id === value
        const Icon = opt.icon
        return (
          <button
            key={opt.id}
            ref={(el) => {
              buttonRefs.current[idx] = el
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            title={opt.title}
            onClick={() => onChange(opt.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`relative z-10 flex items-center justify-center space-x-1.5 rounded-full font-medium whitespace-nowrap shrink-0 transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
              fullWidth ? 'flex-1' : ''
            } ${size === 'md' ? 'h-8 px-4 text-xs' : 'h-7 px-3.5 text-[11px]'} ${
              isActive ? 'text-white' : 'text-white/55 hover:text-white/85'
            }`}
          >
            {Icon && (
              <Icon
                className={`h-3 w-3 shrink-0 ${isActive ? 'text-white' : 'text-white/50'}`}
                strokeWidth={1.75}
              />
            )}
            <span className="whitespace-nowrap">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
