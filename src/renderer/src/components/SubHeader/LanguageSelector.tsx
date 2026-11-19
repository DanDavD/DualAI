import React, { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, Check, Languages } from 'lucide-react'
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../../../../types/language'

interface LanguageSelectorProps {
  label: 'Source Language' | 'Target Language'
  selectedCode: string
  onSelectLanguage: (code: string) => void
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  label,
  selectedCode,
  onSelectLanguage
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const currentLanguage =
    SUPPORTED_LANGUAGES.find((l) => l.code === selectedCode) || SUPPORTED_LANGUAGES[0]

  // Filtered languages based on search query
  const filteredLanguages = useMemo(() => {
    if (!searchQuery.trim()) return SUPPORTED_LANGUAGES
    const q = searchQuery.toLowerCase()
    return SUPPORTED_LANGUAGES.filter(
      (l) =>
        l.code.toLowerCase().includes(q) ||
        l.isoName.toLowerCase().includes(q) ||
        l.displayName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q)
    )
  }, [searchQuery])

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      // Focus search input on open
      setTimeout(() => searchInputRef.current?.focus(), 50)
    } else {
      setSearchQuery('')
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Keyboard accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev + 1) % filteredLanguages.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev - 1 + filteredLanguages.length) % filteredLanguages.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredLanguages[focusedIndex]) {
        onSelectLanguage(filteredLanguages[focusedIndex].code)
        setIsOpen(false)
      }
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
        aria-label={label}
        className="flex h-8 items-center space-x-2 rounded border border-surface-border bg-surface-base px-2.5 text-xs text-text-primary hover:bg-surface-active hover:border-surface-border-subtle focus:outline-none focus:ring-1 focus:ring-accent-steel transition select-none"
        title={`${label}: ${currentLanguage.displayName}`}
      >
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
          {label === 'Source Language' ? 'SRC' : 'TRG'}
        </span>
        <span className="h-3 w-px bg-surface-border" />
        <span className="font-mono font-medium text-text-primary">{currentLanguage.isoName}</span>
        <ChevronDown
          className={`h-3 w-3 text-text-muted transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
          strokeWidth={1.5}
        />
      </button>

      {/* Searchable Dropdown Popover */}
      {isOpen && (
        <div
          role="listbox"
          tabIndex={-1}
          className="absolute left-0 top-10 z-50 w-64 rounded-md border border-surface-border bg-surface-panel p-1.5 shadow-2xl backdrop-blur-md outline-none"
        >
          {/* Search Input */}
          <div className="relative mb-1.5 px-1">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-text-muted" strokeWidth={1.5} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setFocusedIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search language or code..."
              className="w-full rounded border border-surface-border bg-surface-base py-1.5 pl-8 pr-2 text-xs font-mono text-text-primary placeholder-text-muted focus:border-accent-steel focus:outline-none"
            />
          </div>

          {/* Languages List */}
          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {filteredLanguages.length === 0 ? (
              <div className="py-4 text-center font-mono text-xs text-text-muted">
                No matching ISO languages found
              </div>
            ) : (
              filteredLanguages.map((lang, index) => {
                const isSelected = lang.code === selectedCode
                const isFocused = index === focusedIndex

                return (
                  <button
                    key={lang.code}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onSelectLanguage(lang.code)
                      setIsOpen(false)
                    }}
                    onMouseEnter={() => setFocusedIndex(index)}
                    className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-xs transition select-none ${
                      isFocused ? 'bg-surface-active' : ''
                    } ${isSelected ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-[11px]">{lang.isoName}</span>
                    </div>
                    {isSelected && (
                      <Check className="h-3 w-3 text-accent-steel" strokeWidth={2} />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
