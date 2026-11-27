import React, { useState, useRef, useEffect } from 'react'
import { Monitor, AppWindow, ChevronDown, Check } from 'lucide-react'
import { AudioRouteMode } from '../../../../types/audio'
import { useSession } from '../../context/SessionContext'

interface RouteOption {
  id: AudioRouteMode
  label: string
  detail: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}

const ROUTE_OPTIONS: RouteOption[] = [
  {
    id: 'system',
    label: 'System Audio Loopback',
    detail: 'Conference/Meeting audio (Listen-Only)',
    icon: Monitor
  },
  {
    id: 'app',
    label: 'Specific Application',
    detail: 'Target Zoom, Teams, or Browser process',
    icon: AppWindow
  }
]

export const AudioRouteSelector: React.FC = () => {
  const { audioRoute, setAudioRoute } = useSession()

  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const activeOption = ROUTE_OPTIONS.find((opt) => opt.id === audioRoute) || ROUTE_OPTIONS[0]
  const ActiveIcon = activeOption.icon

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
        const idx = ROUTE_OPTIONS.findIndex((o) => o.id === audioRoute)
        setFocusedIndex(Math.max(0, idx))
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      triggerRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev + 1) % ROUTE_OPTIONS.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev - 1 + ROUTE_OPTIONS.length) % ROUTE_OPTIONS.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const selected = ROUTE_OPTIONS[Math.max(0, Math.min(focusedIndex, ROUTE_OPTIONS.length - 1))]
      if (selected) {
        setAudioRoute(selected.id)
      }
      setIsOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Call Audio Source: ${activeOption.label}`}
        className="flex h-8 items-center space-x-2 rounded border border-surface-border bg-surface-base px-2.5 text-xs text-text-primary hover:bg-surface-active hover:border-surface-border-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 transition select-none"
        title="Select Call Audio Source"
      >
        <ActiveIcon className="h-3.5 w-3.5 text-text-secondary" strokeWidth={1.5} />
        <span className="font-medium text-text-primary">{activeOption.label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
          strokeWidth={1.5}
        />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Call Audio Source Options"
          className="absolute left-0 top-10 z-50 w-72 rounded-md border border-surface-border bg-surface-panel p-1.5 shadow-2xl backdrop-blur-md outline-none"
        >
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Call Audio Routing
          </div>

          <div role="listbox" aria-label="Call Audio Source" className="space-y-0.5">
            {ROUTE_OPTIONS.map((option, index) => {
              const isSelected = option.id === audioRoute
              const isFocused = index === focusedIndex
              const OptionIcon = option.icon

              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    setAudioRoute(option.id)
                    setIsOpen(false)
                    triggerRef.current?.focus()
                  }}
                  onMouseEnter={() => setFocusedIndex(index)}
                  className={`flex w-full items-start space-x-2.5 rounded px-2.5 py-2 text-left transition select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 ${
                    isFocused ? 'bg-surface-active' : ''
                  } ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}
                >
                  <OptionIcon
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      isSelected ? 'text-accent-steel' : 'text-text-muted'
                    }`}
                    strokeWidth={1.5}
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>{option.label}</span>
                      {isSelected && (
                        <Check className="h-3 w-3 text-accent-steel" strokeWidth={2} />
                      )}
                    </div>
                    <p className="text-[10px] text-text-muted mt-0.5">{option.detail}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
