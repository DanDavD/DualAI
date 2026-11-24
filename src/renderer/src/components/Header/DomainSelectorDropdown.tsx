import React, { useState, useRef, useEffect } from 'react'
import {
  ChevronDown,
  BookOpen,
  Briefcase,
  Scale,
  Stethoscope,
  Cpu,
  Layers,
  Check
} from 'lucide-react'
import { DomainId, DOMAIN_PRESETS } from '../../../../types/domain'
import { useSession } from '../../context/SessionContext'

const getDomainIcon = (id: DomainId) => {
  switch (id) {
    case 'medical':
      return Stethoscope
    case 'legal':
      return Scale
    case 'technical':
      return Cpu
    case 'business':
      return Briefcase
    default:
      return Layers
  }
}

export const DomainSelectorDropdown: React.FC = () => {
  const { domainId, setDomainId, openGlossaryModal } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const presetList = Object.values(DOMAIN_PRESETS)
  const activePreset = DOMAIN_PRESETS[domainId] || DOMAIN_PRESETS.general
  const ActiveIcon = getDomainIcon(domainId)

  // Close on click outside
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

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
        setFocusedIndex(presetList.findIndex((p) => p.id === domainId))
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev + 1) % presetList.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev - 1 + presetList.length) % presetList.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setDomainId(presetList[focusedIndex].id)
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
        title="Select Specialized Domain Engine"
      >
        <ActiveIcon className="h-3.5 w-3.5 text-text-secondary" strokeWidth={1.5} />
        <span className="font-medium text-text-primary">{activePreset.label}</span>
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
          className="absolute left-0 top-10 z-50 w-80 rounded-md border border-surface-border bg-surface-panel p-1.5 shadow-2xl backdrop-blur-md outline-none"
        >
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Specialized Domain Models
          </div>

          <div className="space-y-0.5">
            {presetList.map((preset, index) => {
              const isSelected = preset.id === domainId
              const isFocused = index === focusedIndex
              const PresetIcon = getDomainIcon(preset.id)

              return (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    setDomainId(preset.id)
                    setIsOpen(false)
                  }}
                  onMouseEnter={() => setFocusedIndex(index)}
                  className={`flex w-full items-start space-x-2.5 rounded px-2.5 py-2 text-left transition select-none ${
                    isFocused ? 'bg-surface-active' : ''
                  } ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}
                >
                  <PresetIcon
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      isSelected ? 'text-accent-steel' : 'text-text-muted'
                    }`}
                    strokeWidth={1.5}
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>{preset.label}</span>
                      {isSelected && (
                        <Check className="h-3 w-3 text-accent-steel" strokeWidth={2} />
                      )}
                    </div>
                    <p className="text-[10px] text-text-muted mt-0.5">{preset.description}</p>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Manage Custom Glossaries Action */}
          <div className="my-1.5 border-t border-surface-border" />

          <button
            type="button"
            onClick={() => {
              setIsOpen(false)
              openGlossaryModal()
            }}
            className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-active hover:text-text-primary transition select-none"
          >
            <div className="flex items-center space-x-2">
              <BookOpen className="h-3.5 w-3.5 text-accent-steel" strokeWidth={1.5} />
              <span>Manage Custom Glossaries</span>
            </div>
            <span className="font-mono text-[10px] text-text-muted">CSV / JSON</span>
          </button>
        </div>
      )}
    </div>
  )
}
