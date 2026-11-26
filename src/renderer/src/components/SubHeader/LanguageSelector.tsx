import React, { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, Check } from 'lucide-react'
import { SUPPORTED_LANGUAGES, SupportedLanguage } from '../../../../types/language'
import { GlassTooltip } from '../UI/GlassTooltip'

interface LanguageSelectorProps {
  label: 'Source Language' | 'Target Language'
  selectedCode: string
  onSelectLanguage: (code: string) => void
  compact?: boolean
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  label,
  selectedCode,
  onSelectLanguage,
  compact = false
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const currentLanguage =
    SUPPORTED_LANGUAGES.find((l) => l.code === selectedCode) || SUPPORTED_LANGUAGES[0]

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      setTimeout(() => searchInputRef.current?.focus(), 40)
    } else {
      setSearchQuery('')
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
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => (prev + 1) % Math.max(1, filteredLanguages.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex(
        (prev) => (prev - 1 + Math.max(1, filteredLanguages.length)) % Math.max(1, filteredLanguages.length)
      )
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
      <GlassTooltip
        label={label}
        description={`Currently ${currentLanguage.displayName}`}
        disabled={isOpen}
      >
        <button
          type="button"
          data-toolbar-item="true"
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={handleKeyDown}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label}
          className={`glass-control-hover flex h-7 w-[86px] sm:w-[98px] items-center justify-between rounded-full px-2.5 text-xs font-medium whitespace-nowrap select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 ${
            isOpen ? 'bg-white/[0.15] text-white' : 'text-white/90 hover:text-white'
          }`}
        >
          <span
            className={
              compact
                ? 'inline font-mono text-[11px] uppercase'
                : 'hidden sm:inline truncate pr-1 text-left'
            }
          >
            {compact ? currentLanguage.code.toUpperCase() : currentLanguage.nativeName}
          </span>
          {!compact && (
            <span className="inline sm:hidden font-mono text-[11px] uppercase truncate pr-1">
              {currentLanguage.code.toUpperCase()}
            </span>
          )}
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-white/45 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
            strokeWidth={1.75}
          />
        </button>
      </GlassTooltip>

      {isOpen && (
        <div
          role="listbox"
          tabIndex={-1}
          className="glass-sheet animate-glass-pop absolute left-1/2 -translate-x-1/2 top-10 z-50 w-[292px] rounded-[20px] p-2 outline-none"
        >
          {/* Liquid Glass Search Input */}
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40"
              strokeWidth={1.75}
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setFocusedIndex(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search language..."
              className="h-8 w-full rounded-full border border-white/[0.09] bg-white/[0.06] pl-8 pr-3 text-xs text-white placeholder:text-white/35 focus:border-accent-steel/70 focus:bg-white/[0.09] focus:outline-none transition"
            />
          </div>

          {/* Scrollable 2-Line Language List (Zero Truncation Overlap) */}
          <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
            {filteredLanguages.length === 0 ? (
              <div className="py-5 text-center text-xs text-white/40">No languages found</div>
            ) : (
              filteredLanguages.map((lang: SupportedLanguage, idx: number) => {
                const isSelected = lang.code === selectedCode
                const isFocused = idx === focusedIndex
                const showSecondary = lang.nativeName.toLowerCase() !== lang.displayName.toLowerCase()

                return (
                  <button
                    key={lang.code}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setFocusedIndex(idx)}
                    onClick={() => {
                      onSelectLanguage(lang.code)
                      setIsOpen(false)
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 ${
                      isSelected
                        ? 'bg-accent-steel/22 text-white'
                        : isFocused
                          ? 'bg-white/[0.08] text-white'
                          : 'text-white/80 hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="w-8 shrink-0 rounded-md bg-white/[0.06] py-0.5 text-center font-mono text-[10px] uppercase text-white/55">
                        {lang.code}
                      </span>
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="text-xs font-medium text-white truncate">
                          {lang.nativeName}
                        </div>
                        {showSecondary && (
                          <div className="mt-0.5 text-[10px] text-white/45 truncate">
                            {lang.displayName}
                          </div>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-accent-steel"
                        strokeWidth={2.25}
                      />
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
