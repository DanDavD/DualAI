import React from 'react'
import { Settings, Minus, Square, X } from 'lucide-react'
import { AudioRouteSelector } from './AudioRouteSelector'
import { OperatingModeSegmented } from './OperatingModeSegmented'
import { DomainSelectorDropdown } from './DomainSelectorDropdown'
import { LatencyMetricBadge } from './LatencyMetricBadge'
import { QuotaGauge } from './QuotaGauge'
import { useSession } from '../../context/SessionContext'

export const Header: React.FC = () => {
  const { openSettingsModal } = useSession()

  const handleMinimize = () => window.electronAPI?.minimizeWindow?.()
  const handleMaximize = () => window.electronAPI?.maximizeWindow?.()
  const handleClose = () => window.electronAPI?.closeWindow?.()

  return (
    <header className="flex h-12 w-full shrink-0 items-center justify-between border-b border-surface-border bg-surface-panel px-3 select-none">
      {/* Left Cluster: Wordmark + Version + Audio Routing */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <span className="font-bold tracking-tight text-sm text-text-primary">DUALAI</span>
          <span className="rounded bg-surface-border px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
            v1.0.0-PRO
          </span>
        </div>

        <span className="h-4 w-px bg-surface-border" />

        {/* Audio Inbound Route Selector */}
        <AudioRouteSelector />
      </div>

      {/* Center Cluster: Operating Mode Switch */}
      <div className="flex items-center justify-center">
        <OperatingModeSegmented />
      </div>

      {/* Center-Right Cluster: Domain Preset Selector */}
      <div className="flex items-center space-x-2">
        <DomainSelectorDropdown />
      </div>

      {/* Right Cluster: Telemetry Metrics + Settings + Window Controls */}
      <div className="flex items-center space-x-2.5">
        {/* Latency Monitor */}
        <LatencyMetricBadge />

        {/* Plan Quota Gauge */}
        <QuotaGauge />

        {/* Settings Action */}
        <button
          type="button"
          onClick={openSettingsModal}
          className="flex h-8 w-8 items-center justify-center rounded border border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-steel transition"
          title="Global Settings & API Keys"
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        {/* Native Window Controls */}
        <div className="flex items-center space-x-0.5 border-l border-surface-border pl-2">
          <button
            type="button"
            onClick={handleMinimize}
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-active hover:text-text-primary transition"
            title="Minimize"
          >
            <Minus className="h-3 w-3" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-active hover:text-text-primary transition"
            title="Maximize / Restore"
          >
            <Square className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-accent-crimson/20 hover:text-accent-crimson transition"
            title="Close"
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </header>
  )
}
