import React from 'react'
import { ArrowRight, ArrowRightLeft } from 'lucide-react'
import { OperatingMode } from '../../../../types/audio'
import { useSession } from '../../context/SessionContext'

export const OperatingModeSegmented: React.FC = () => {
  const { operatingMode, setOperatingMode } = useSession()

  const handleKeyDown = (e: React.KeyboardEvent, mode: OperatingMode) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setOperatingMode(mode === 'translate' ? 'conversation' : 'translate')
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOperatingMode(mode)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Operating Mode"
      className="flex h-8 items-center rounded border border-surface-border bg-surface-base p-0.5 select-none"
    >
      {/* Translate (Unidirectional) */}
      <button
        type="button"
        role="radio"
        aria-checked={operatingMode === 'translate'}
        tabIndex={operatingMode === 'translate' ? 0 : -1}
        onClick={() => setOperatingMode('translate')}
        onKeyDown={(e) => handleKeyDown(e, 'translate')}
        className={`flex h-full items-center space-x-1.5 rounded px-2.5 text-xs font-medium transition focus:outline-none focus:ring-1 focus:ring-accent-steel ${
          operatingMode === 'translate'
            ? 'bg-surface-active text-text-primary shadow-sm border border-surface-border'
            : 'text-text-muted hover:text-text-secondary'
        }`}
        title="Unidirectional mode: Source language to Target language"
      >
        <ArrowRight className="h-3 w-3 text-text-muted" strokeWidth={1.5} />
        <span>Translate</span>
      </button>

      {/* Conversation (Bidirectional) */}
      <button
        type="button"
        role="radio"
        aria-checked={operatingMode === 'conversation'}
        tabIndex={operatingMode === 'conversation' ? 0 : -1}
        onClick={() => setOperatingMode('conversation')}
        onKeyDown={(e) => handleKeyDown(e, 'conversation')}
        className={`flex h-full items-center space-x-1.5 rounded px-2.5 text-xs font-medium transition focus:outline-none focus:ring-1 focus:ring-accent-steel ${
          operatingMode === 'conversation'
            ? 'bg-surface-active text-text-primary shadow-sm border border-surface-border'
            : 'text-text-muted hover:text-text-secondary'
        }`}
        title="Bidirectional mode: Real-time dual-speaker alternating translation"
      >
        <ArrowRightLeft className="h-3 w-3 text-accent-steel" strokeWidth={1.5} />
        <span>Conversation</span>
      </button>
    </div>
  )
}
