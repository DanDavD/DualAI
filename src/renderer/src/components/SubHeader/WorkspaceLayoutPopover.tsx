/**
 * DUALAI - Dedicated Workspace Layout Selector Menu (CARD-16)
 * Separated cleanly from typography settings so interpreters can switch
 * between Dual-Pane 50/50, Translation Focus, and Compact Stacked layouts in one click.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Columns2, Maximize2, Rows2, ChevronDown, Check } from 'lucide-react'
import { WorkspaceViewMode } from '../../../../types/settings'
import { useSession } from '../../context/SessionContext'
import { VIEW_MODE_OPTIONS } from '../../utils/typographyPreferences'

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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Workspace Layout"
        className={`flex h-7 items-center space-x-1.5 rounded border px-2.5 text-[11px] font-medium transition focus:outline-none focus:ring-1 focus:ring-accent-steel ${
          isOpen
            ? 'border-accent-steel bg-accent-steel/15 text-text-primary'
            : 'border-surface-border bg-surface-panel text-text-secondary hover:bg-surface-active hover:text-text-primary'
        }`}
        title="Change workspace layout (Dual, Target Focus, or Stacked)"
      >
        <ActiveIcon className="h-3.5 w-3.5" strokeWidth={1.6} />
        <span>{activeOption.shortLabel}</span>
        <ChevronDown className="h-3 w-3 text-text-muted" strokeWidth={1.6} />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Select Workspace Layout"
          className="absolute right-0 top-9 z-40 w-[250px] rounded-lg border border-surface-border bg-surface-panel p-2 text-xs text-text-primary shadow-2xl space-y-1"
        >
          <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
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
                className={`flex w-full items-start justify-between rounded-md border px-2.5 py-2 text-left transition ${
                  active
                    ? 'border-accent-steel/70 bg-accent-steel/10 text-text-primary'
                    : 'border-transparent bg-transparent text-text-secondary hover:bg-surface-active hover:text-text-primary'
                }`}
              >
                <div className="flex items-start space-x-2.5 pr-2">
                  <Icon
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      active ? 'text-accent-steel' : 'text-text-muted'
                    }`}
                    strokeWidth={1.6}
                  />
                  <div>
                    <div className="text-[11px] font-semibold leading-tight">{opt.label}</div>
                    <p className="mt-0.5 text-[10px] leading-snug text-text-muted">
                      {opt.description}
                    </p>
                  </div>
                </div>
                {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-steel" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
