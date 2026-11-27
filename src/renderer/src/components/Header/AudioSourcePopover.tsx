import React, { useEffect, useRef, useState } from 'react'
import { Volume2, AppWindow, ChevronDown } from 'lucide-react'
import { AudioRouteMode } from '../../../../types/audio'
import { useSession } from '../../context/SessionContext'
import { GlassTooltip } from '../UI/GlassTooltip'

const ROUTE_OPTIONS: Array<{
  id: AudioRouteMode
  shortLabel: string
  label: string
  detail: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}> = [
  {
    id: 'system',
    shortLabel: 'System',
    label: 'System Audio',
    detail: 'All meetings & calls',
    icon: Volume2
  },
  {
    id: 'app',
    shortLabel: 'App',
    label: 'Single App',
    detail: 'Zoom, Teams, browser',
    icon: AppWindow
  }
]

/**
 * Single-purpose Listen-Only Call Audio Source Liquid Glass Popover.
 * DualAI strictly interprets inbound call/system audio and never captures or bills your microphone.
 */
export const AudioSourcePopover: React.FC = () => {
  const { audioRoute, setAudioRoute } = useSession()

  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const activeRoute = ROUTE_OPTIONS.find((r) => r.id === audioRoute) || ROUTE_OPTIONS[0]
  const ActiveRouteIcon = activeRoute.icon

  return (
    <div ref={containerRef} className="relative" data-tour-id="audio-source">
      <GlassTooltip
        label="Call Audio Source"
        description={`Active: ${activeRoute.label} — listens to system call audio only`}
        disabled={isOpen}
      >
        <button
          ref={triggerRef}
          type="button"
          data-toolbar-item="true"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={`Call Audio Source: ${activeRoute.label}`}
          className={`glass-control-hover flex h-7 items-center space-x-1.5 rounded-full px-2 text-[11px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 ${
            isOpen ? 'bg-white/[0.15] text-white' : 'text-white/80 hover:text-white'
          }`}
        >
          <ActiveRouteIcon className="h-3.5 w-3.5 text-accent-steel shrink-0" strokeWidth={1.75} />
          <span className="hidden xl:inline whitespace-nowrap">{activeRoute.shortLabel}</span>
          <ChevronDown
            className={`hidden xl:inline h-3 w-3 text-white/45 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
            strokeWidth={1.75}
          />
        </button>
      </GlassTooltip>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Call Audio Source"
          className="glass-sheet animate-glass-pop absolute right-0 top-10 z-50 w-[312px] rounded-[22px] p-3.5 text-xs text-text-primary space-y-3"
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-[12px] font-semibold text-white">Call Audio Source</span>
            <span className="text-[10px] text-white/40">Listen-only mode</span>
          </div>

          <div role="radiogroup" aria-label="Call Audio Source" className="grid grid-cols-2 gap-1.5">
            {ROUTE_OPTIONS.map((option, idx) => {
              const Icon = option.icon
              const isSelected = audioRoute === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setAudioRoute(option.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                      e.preventDefault()
                      const nextIdx = (idx + 1) % ROUTE_OPTIONS.length
                      setAudioRoute(ROUTE_OPTIONS[nextIdx].id)
                      const siblings = e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                      siblings?.[nextIdx]?.focus()
                    }
                  }}
                  className={`glass-control-hover flex items-start space-x-2.5 rounded-2xl p-2.5 text-left border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 ${
                    isSelected
                      ? 'bg-accent-steel/18 border-accent-steel/50 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]'
                      : 'bg-white/[0.04] border-white/[0.06] text-white/75 hover:bg-white/[0.08]'
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      isSelected ? 'bg-accent-steel text-white' : 'bg-white/[0.08] text-white/60'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold leading-tight truncate">
                      {option.label}
                    </div>
                    <div className="text-[10px] text-white/45 leading-tight mt-0.5 truncate">
                      {option.detail}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="glass-grouped-card rounded-2xl px-3 py-2.5">
            <div className="text-[10px] leading-relaxed text-white/50">
              Your microphone is never sent to AI — use{' '}
              <span className="font-mono text-white/80">SPACE</span> anytime to mute your mic
              system-wide during calls or hold.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
