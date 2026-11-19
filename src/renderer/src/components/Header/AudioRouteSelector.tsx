import React, { useState, useRef, useEffect } from 'react'
import {
  Mic,
  Monitor,
  ArrowRightLeft,
  AppWindow,
  ChevronDown,
  Volume2,
  Check
} from 'lucide-react'
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
    id: 'bilateral',
    label: 'Bilateral Interpretation',
    detail: 'Microphone + System Audio (Two-way)',
    icon: ArrowRightLeft
  },
  {
    id: 'mic',
    label: 'Microphone Input Only',
    detail: 'Local microphone capture (Channel A)',
    icon: Mic
  },
  {
    id: 'system',
    label: 'System Audio Loopback',
    detail: 'Conference/Meeting audio (Channel B)',
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
  const {
    audioRoute,
    setAudioRoute,
    noiseSuppression,
    setNoiseSuppression,
    echoCancellation,
    setEchoCancellation
  } = useSession()

  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const activeOption = ROUTE_OPTIONS.find((opt) => opt.id === audioRoute) || ROUTE_OPTIONS[0]
  const ActiveIcon = activeOption.icon

  // Close on outside click
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

  // Keyboard navigation for dropdown accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
        setFocusedIndex(ROUTE_OPTIONS.findIndex((o) => o.id === audioRoute))
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev + 1) % ROUTE_OPTIONS.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev - 1 + ROUTE_OPTIONS.length) % ROUTE_OPTIONS.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setAudioRoute(ROUTE_OPTIONS[focusedIndex].id)
      setIsOpen(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex h-8 items-center space-x-2 rounded border border-surface-border bg-surface-base px-2.5 text-xs text-text-primary hover:bg-surface-active hover:border-surface-border-subtle focus:outline-none focus:ring-1 focus:ring-accent-steel transition select-none"
        title="Select Inbound Audio Routing"
      >
        <ActiveIcon className="h-3.5 w-3.5 text-text-secondary" strokeWidth={1.5} />
        <span className="font-medium text-text-primary">{activeOption.label}</span>
        <ChevronDown
          className={`h-3 w-3 text-text-muted transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
          strokeWidth={1.5}
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div
          role="listbox"
          tabIndex={-1}
          className="absolute left-0 top-10 z-50 w-72 rounded-md border border-surface-border bg-surface-panel p-1.5 shadow-2xl backdrop-blur-md outline-none"
        >
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Inbound Audio Routing
          </div>

          <div className="space-y-0.5">
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
                  }}
                  onMouseEnter={() => setFocusedIndex(index)}
                  className={`flex w-full items-start space-x-2.5 rounded px-2.5 py-2 text-left transition select-none ${
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

          {/* Audio Processing Toggles Divider */}
          <div className="my-1.5 border-t border-surface-border" />

          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Hardware Audio Processing
          </div>

          {/* Noise Suppression Toggle */}
          <div className="flex items-center justify-between px-2.5 py-1.5 text-xs text-text-secondary">
            <span className="font-medium">Noise Suppression (RNNoise)</span>
            <button
              type="button"
              role="switch"
              aria-checked={noiseSuppression}
              onClick={() => setNoiseSuppression(!noiseSuppression)}
              className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-150 ease-in-out focus:outline-none ${
                noiseSuppression ? 'bg-accent-steel' : 'bg-surface-border'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-text-primary shadow transition duration-150 ease-in-out ${
                  noiseSuppression ? 'translate-x-3' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Echo Cancellation Toggle */}
          <div className="flex items-center justify-between px-2.5 py-1.5 text-xs text-text-secondary">
            <span className="font-medium">Echo Cancellation (AEC)</span>
            <button
              type="button"
              role="switch"
              aria-checked={echoCancellation}
              onClick={() => setEchoCancellation(!echoCancellation)}
              className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-150 ease-in-out focus:outline-none ${
                echoCancellation ? 'bg-accent-steel' : 'bg-surface-border'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-text-primary shadow transition duration-150 ease-in-out ${
                  echoCancellation ? 'translate-x-3' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
