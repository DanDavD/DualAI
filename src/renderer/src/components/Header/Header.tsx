import React, { useEffect, useState } from 'react'
import { Settings, Minus, Square, X, User } from 'lucide-react'
import { AudioRouteSelector } from './AudioRouteSelector'
import { OperatingModeSegmented } from './OperatingModeSegmented'
import { DomainSelectorDropdown } from './DomainSelectorDropdown'
import { QuotaGauge } from './QuotaGauge'
import { useSession } from '../../context/SessionContext'

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export const Header: React.FC = () => {
  const {
    openSettingsModal,
    openAccountModal,
    isAudioActive,
    isGatewayAuthenticated,
    authSession
  } = useSession()

  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (!isAudioActive) {
      setElapsedSeconds(0)
      return
    }
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [isAudioActive])

  const handleMinimize = () => window.electronAPI?.minimizeWindow?.()
  const handleMaximize = () => window.electronAPI?.maximizeWindow?.()
  const handleClose = () => window.electronAPI?.closeWindow?.()

  return (
    <header className="flex h-12 w-full shrink-0 items-center justify-between border-b border-surface-border bg-surface-panel px-4 select-none">
      {/* Left Cluster: Wordmark, Live Status, Audio Route, Mode & Domain */}
      <div className="flex items-center space-x-2.5">
        <div className="flex items-center space-x-2 pr-1">
          <span className="font-bold tracking-tight text-sm text-text-primary">DUALAI</span>
          {isAudioActive && (
            <span className="flex items-center space-x-1 rounded bg-accent-crimson/15 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-accent-crimson">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-crimson animate-pulse" />
              <span>LIVE</span>
            </span>
          )}
        </div>

        <span className="h-4 w-px bg-surface-border" />

        <AudioRouteSelector />
        <OperatingModeSegmented />
        <DomainSelectorDropdown />
      </div>

      {/* Right Cluster: Session Timer, Plan Quota, Account, Settings & Window Controls */}
      <div className="flex items-center space-x-2">
        {isAudioActive && (
          <span className="font-mono text-xs tabular-nums text-text-secondary pr-1">
            {formatElapsed(elapsedSeconds)}
          </span>
        )}

        <QuotaGauge />

        <button
          type="button"
          onClick={openAccountModal}
          className="flex h-8 items-center space-x-1.5 rounded border border-surface-border bg-surface-base px-2.5 text-xs text-text-secondary hover:bg-surface-active hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-steel transition"
          title={
            isGatewayAuthenticated && authSession
              ? `Signed in as ${authSession.user.email}`
              : 'Sign in for 1-Hour Free Tier'
          }
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isGatewayAuthenticated ? 'bg-accent-emerald' : 'bg-text-muted'
            }`}
          />
          <User className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span className="hidden md:inline font-medium text-text-primary">
            {isGatewayAuthenticated ? 'Account' : 'Sign In'}
          </span>
        </button>

        <button
          type="button"
          onClick={openSettingsModal}
          className="flex h-8 w-8 items-center justify-center rounded border border-surface-border bg-surface-base text-text-secondary hover:bg-surface-active hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-steel transition"
          title="Settings & Glossary (Cmd/Ctrl+,)"
          aria-label="Open Settings"
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        {/* Native Window Controls */}
        <div className="flex items-center space-x-0.5 border-l border-surface-border pl-1.5">
          <button
            type="button"
            onClick={handleMinimize}
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-active hover:text-text-primary transition"
            title="Minimize"
            aria-label="Minimize Window"
          >
            <Minus className="h-3 w-3" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-active hover:text-text-primary transition"
            title="Maximize / Restore"
            aria-label="Maximize Window"
          >
            <Square className="h-2.5 w-2.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-accent-crimson/20 hover:text-accent-crimson transition"
            title="Close"
            aria-label="Close Window"
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </header>
  )
}
