/**
 * DUALAI - Dedicated Workspace Layout Selector Menu (Apple Liquid Glass)
 * Switches seamlessly between Dual-Pane 50/50, Translation Focus, and Compact Stacked layouts.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Columns2, Maximize2, Rows2, Check } from 'lucide-react'
import { WorkspaceViewMode } from '../../../../types/settings'
import { useSession } from '../../context/SessionContext'
import { VIEW_MODE_OPTIONS } from '../../utils/typographyPreferences'
import { GlassTooltip } from '../UI/GlassTooltip'

const VIEW_ICONS: Record<
  WorkspaceViewMode,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  dual: Columns2,
  target_only: Maximize2,
  stacked: Rows2
}

export const WorkspaceLayoutPopover: React.FC = () => {
  const { workspaceDisplaySettings, updateWorkspaceDisplaySettings } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const currentMode = workspaceDisplaySettings.viewMode
  const activeOption = VIEW_MODE_OPTIONS.find((o) => o.id === currentMode) || VIEW_MODE_OPTIONS[0]
  const ActiveIcon = VIEW_ICONS[currentMode]

  return (
    <div ref={containerRef} className="relative" data-tour-id="layout">
      <GlassTooltip
        label="Reading Layout"
        description={`Active: ${activeOption.label}`}
        disabled={isOpen}
      >
        <button
          type="button"
          data-toolbar-item="true"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label="Workspace Layout"
          className={`glass-control-hover flex h-7 items-center space-x-1.5 rounded-full px-2 text-[11px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 ${
            isOpen ? 'bg-white/[0.15] text-white' : 'text-white/75 hover:text-white'
          }`}
        >
          <ActiveIcon className="h-3.5 w-3.5" strokeWidth={1.7} />
          <span className="hidden 2xl:inline">{activeOption.shortLabel}</span>
        </button>
      </GlassTooltip>

      {isOpen && (
        <div
          role="menu"
          aria-label="Select Workspace Layout"
          className="glass-sheet animate-glass-pop absolute right-0 top-10 z-50 w-[264px] rounded-[20px] p-2 text-xs text-text-primary space-y-1"
        >
          <div className="px-2.5 py-1 text-[11px] font-medium text-white/50">
            Workspace Layout
          </div>
          {VIEW_MODE_OPTIONS.map((opt) => {
            const Icon = VIEW_ICONS[opt.id]
            const active = currentMode === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  updateWorkspaceDisplaySettings({ viewMode: opt.id })
                  setIsOpen(false)
                }}
                className={`glass-control-hover flex w-full items-start justify-between rounded-2xl border px-2.5 py-2 text-left ${
                  active
                    ? 'border-accent-steel/50 bg-accent-steel/18 text-white'
                    : 'border-transparent bg-transparent text-white/75 hover:bg-white/[0.07] hover:text-white'
                }`}
              >
                <div className="flex items-start space-x-2.5 pr-2">
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      active ? 'bg-accent-steel text-white' : 'bg-white/[0.08] text-white/55'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold leading-tight">{opt.label}</div>
                    <p className="mt-0.5 text-[10px] leading-snug text-white/45">
                      {opt.description}
                    </p>
                  </div>
                </div>
                {active && (
                  <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-accent-steel" strokeWidth={2.25} />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
