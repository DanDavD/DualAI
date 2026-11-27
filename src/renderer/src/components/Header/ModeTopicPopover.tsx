import React, { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  Layers,
  Stethoscope,
  Scale,
  Cpu,
  Briefcase,
  Check,
  Sparkles
} from 'lucide-react'
import { OperatingMode } from '../../../../types/audio'
import { DomainId, DOMAIN_PRESETS } from '../../../../types/domain'
import { useSession } from '../../context/SessionContext'
import { GlassSegmentedControl } from '../UI/GlassSegmentedControl'
import { GlassTooltip } from '../UI/GlassTooltip'

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

/**
 * Single-purpose Mode & Topic Liquid Glass Popover.
 * Dedicated strictly to HOW DualAI translates: Mode (Translate/Conversation),
 * Speed (Live/Accurate), and Conversation Topic (General, Medical, Legal, Tech, Business).
 */
export const ModeTopicPopover: React.FC = () => {
  const {
    operatingMode,
    setOperatingMode,
    domainId,
    setDomainId
  } = useSession()

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
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const presetList = Object.values(DOMAIN_PRESETS)
  const activePreset = DOMAIN_PRESETS[domainId] || DOMAIN_PRESETS.general
  const shortTopic = activePreset.label.split('/')[0].trim()

  return (
    <div ref={containerRef} className="relative" data-tour-id="mode-topic">
      <GlassTooltip
        label="Mode & Topic"
        description={`${operatingMode === 'conversation' ? 'Two-way' : 'One-way'} · ${shortTopic}`}
        disabled={isOpen}
      >
        <button
          type="button"
          data-toolbar-item="true"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label="Translation Mode and Topic"
          className={`glass-control-hover flex h-7 items-center space-x-1.5 rounded-full px-2 text-[11px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70 ${
            isOpen ? 'bg-white/[0.15] text-white' : 'text-white/75 hover:text-white'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-white/80 shrink-0" strokeWidth={1.75} />
          <span className="hidden 2xl:inline whitespace-nowrap">{shortTopic}</span>
        </button>
      </GlassTooltip>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Translation Mode and Topic"
          className="glass-sheet animate-glass-pop absolute right-0 top-10 z-50 w-[332px] rounded-[22px] p-3.5 text-xs text-text-primary space-y-3.5"
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-[12px] font-semibold text-white">Mode & Topic</span>
            <span className="text-[10px] text-white/40">How DualAI translates</span>
          </div>

          <div className="glass-grouped-card rounded-2xl p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-white/65 pl-1">Mode</span>
              <GlassSegmentedControl<OperatingMode>
                ariaLabel="Operating Mode"
                value={operatingMode}
                onChange={setOperatingMode}
                options={[
                  {
                    id: 'translate',
                    label: 'Translate',
                    icon: ArrowRight,
                    title: 'One-way translation: Source to Target'
                  },
                  {
                    id: 'conversation',
                    label: 'Conversation',
                    icon: ArrowRightLeft,
                    title: 'Two-way live conversation between both languages'
                  }
                ]}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-medium text-white/55">Conversation Topic</span>
              <span className="text-[10px] text-white/35">Tailors vocabulary</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presetList.map((preset) => {
                const Icon = getDomainIcon(preset.id)
                const isSelected = domainId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setDomainId(preset.id)}
                    title={preset.description}
                    className={`glass-control-hover flex items-center space-x-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border ${
                      isSelected
                        ? 'bg-accent-steel/20 border-accent-steel/55 text-white'
                        : 'bg-white/[0.04] border-white/[0.07] text-white/65 hover:text-white'
                    }`}
                  >
                    <Icon className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    <span>{preset.label}</span>
                    {isSelected && (
                      <Check className="h-2.5 w-2.5 shrink-0 text-accent-steel" strokeWidth={2.25} />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
