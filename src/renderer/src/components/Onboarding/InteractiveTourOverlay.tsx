import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Languages,
  Volume2,
  Sparkles,
  Columns2,
  Type,
  PictureInPicture2,
  UserCheck,
  Settings,
  ArrowRightLeft,
  AppWindow,
  Mic,
  Headphones,
  Trash2,
  Play,
  ChevronLeft,
  ChevronRight,
  X,
  Check
} from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { formatPlatformShortcut } from '../../utils/platform'

interface TourStepDefinition {
  id: string
  targetId: string
  section: string
  title: string
  description: string
  shortcut?: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  padding?: number
  radius?: number
  preferredPlacement?: 'bottom' | 'top'
}

interface TargetGeometry {
  top: number
  left: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}

const CARD_WIDTH = 332
const VIEWPORT_MARGIN = 16
const CARET_GAP = 14

const TOUR_STEPS: TourStepDefinition[] = [
  {
    id: 'languages',
    targetId: 'languages',
    section: 'Top Bar',
    title: 'Language Pair',
    description:
      'Choose the spoken language and your target translation language, or click the center arrows to swap directions instantly.',
    shortcut: 'CommandOrControl+Shift+S',
    icon: Languages,
    padding: 6,
    radius: 9999,
    preferredPlacement: 'bottom'
  },
  {
    id: 'audio-source',
    targetId: 'audio-source',
    section: 'Top Bar',
    title: 'Audio Source',
    description:
      'Switch anytime between capturing all System Audio or isolating a single call window like Zoom, Teams, or Google Meet.',
    icon: Volume2,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'bottom'
  },
  {
    id: 'mode-topic',
    targetId: 'mode-topic',
    section: 'Top Bar',
    title: 'Mode & Vocabulary Domain',
    description:
      'Switch between One-Way and Two-Way interpretation and select specialized domains like Medical, Legal, or Business for domain-accurate terminology.',
    icon: Sparkles,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'bottom'
  },
  {
    id: 'layout',
    targetId: 'layout',
    section: 'Top Bar',
    title: 'Reading Layout',
    description:
      'Toggle between Dual-Pane 50/50 side-by-side columns or a Compact Stacked feed tailored for narrow windows.',
    icon: Columns2,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'bottom'
  },
  {
    id: 'typography',
    targetId: 'typography',
    section: 'Top Bar',
    title: 'Text & Color Personalization',
    description:
      'Customize font family, text size, line spacing, and custom color pairs for spoken and translated text.',
    icon: Type,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'bottom'
  },
  {
    id: 'teleprompter',
    targetId: 'teleprompter',
    section: 'Top Bar',
    title: 'Mini View Settings',
    description:
      'Adjust glass opacity, text size, visible line count, and click-through behavior for the floating Mini View overlay.',
    shortcut: 'CommandOrControl+Shift+H',
    icon: PictureInPicture2,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'bottom'
  },
  {
    id: 'account',
    targetId: 'account',
    section: 'Top Bar',
    title: 'Account & Remaining Hours',
    description:
      'Track your remaining interpretation hours in real time, manage your subscription plan, or switch accounts.',
    icon: UserCheck,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'bottom'
  },
  {
    id: 'settings',
    targetId: 'settings',
    section: 'Top Bar',
    title: 'Settings & Privacy',
    description:
      'Configure audio hardware, voice sensitivity, keyboard shortcuts, and Zero-Data Retention privacy guarantees.',
    shortcut: 'CommandOrControl+,',
    icon: Settings,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'bottom'
  },
  {
    id: 'hero-mode',
    targetId: 'hero-mode',
    section: 'Quick Setup',
    title: 'Interpretation Mode',
    description:
      'Use One-Way Translate for a single spoken language, or Two-Way Conversation for automatic back-and-forth bilingual dialogue.',
    icon: ArrowRightLeft,
    padding: 6,
    radius: 9999,
    preferredPlacement: 'bottom'
  },
  {
    id: 'hero-audio-source',
    targetId: 'hero-audio-source',
    section: 'Quick Setup',
    title: 'Call Audio Capture',
    description:
      'Select System Audio to translate all meetings and calls, or Single App to capture audio from one specific window.',
    icon: AppWindow,
    padding: 8,
    radius: 26,
    preferredPlacement: 'top'
  },
  {
    id: 'mute',
    targetId: 'mute',
    section: 'Session Controls',
    title: 'Call Microphone Mute',
    description:
      'Mute or unmute your system microphone across Zoom, Teams, and Meet. DualAI runs in Listen-Only mode and never listens to your mic.',
    shortcut: 'SPACE',
    icon: Mic,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'top'
  },
  {
    id: 'headphones',
    targetId: 'headphones',
    section: 'Session Controls',
    title: 'Pause Listening & Output',
    description:
      'Pause live translation without muting your speakers, or open the dropdown arrow to switch your audio output device.',
    icon: Headphones,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'top'
  },
  {
    id: 'clear',
    targetId: 'clear',
    section: 'Session Controls',
    title: 'Clear Transcript Feed',
    description:
      'Instantly clear all transcripts from the workspace between calls for a clean, private screen.',
    shortcut: 'CommandOrControl+Shift+K',
    icon: Trash2,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'top'
  },
  {
    id: 'mini-view',
    targetId: 'mini-view',
    section: 'Session Controls',
    title: 'Launch Mini View',
    description:
      'Shrink into a compact floating overlay that stays above your video calls with full color and typography sync.',
    shortcut: 'CommandOrControl+Shift+H',
    icon: PictureInPicture2,
    padding: 5,
    radius: 9999,
    preferredPlacement: 'top'
  },
  {
    id: 'start-stop',
    targetId: 'start-stop',
    section: 'Session Controls',
    title: 'Start Interpreting',
    description:
      'Press Start whenever you are ready to begin live sub-second translation. Press again anytime to stop the session.',
    icon: Play,
    padding: 6,
    radius: 9999,
    preferredPlacement: 'top'
  }
]

function isElementVisible(el: HTMLElement | null): el is HTMLElement {
  if (!el) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function measureTarget(targetId: string): TargetGeometry | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  const el = document.querySelector<HTMLElement>(`[data-tour-id="${targetId}"]`)
  if (!isElementVisible(el)) return null
  const rect = el.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  }
}

export const InteractiveTourOverlay: React.FC = () => {
  const { isProductTourOpen, closeProductTour } = useSession()
  const [activeSteps, setActiveSteps] = useState<TourStepDefinition[]>([])
  const [stepIndex, setStepIndex] = useState(0)
  const [geometry, setGeometry] = useState<TargetGeometry | null>(null)
  const nextButtonRef = useRef<HTMLButtonElement>(null)

  // Compute currently mounted & visible steps whenever the tour opens
  useEffect(() => {
    if (!isProductTourOpen) return
    const visible = TOUR_STEPS.filter((step) => {
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${step.targetId}"]`)
      return isElementVisible(el)
    })
    if (visible.length === 0) {
      closeProductTour(true)
      return
    }
    setActiveSteps(visible)
    setStepIndex(0)
  }, [isProductTourOpen, closeProductTour])

  const currentStep = activeSteps[stepIndex] || null

  const syncGeometry = useCallback(() => {
    if (!currentStep) return
    const measured = measureTarget(currentStep.targetId)
    if (measured) {
      setGeometry(measured)
    }
  }, [currentStep])

  // Measure on step change, window resize, and target layout changes
  useEffect(() => {
    if (!isProductTourOpen || !currentStep) return
    syncGeometry()

    const el = document.querySelector<HTMLElement>(`[data-tour-id="${currentStep.targetId}"]`)
    const observer =
      typeof ResizeObserver !== 'undefined' && el
        ? new ResizeObserver(() => syncGeometry())
        : null
    if (observer && el) observer.observe(el)

    window.addEventListener('resize', syncGeometry)
    window.addEventListener('scroll', syncGeometry, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', syncGeometry)
      window.removeEventListener('scroll', syncGeometry, true)
    }
  }, [isProductTourOpen, currentStep, syncGeometry])

  const handleNext = useCallback(() => {
    if (stepIndex >= activeSteps.length - 1) {
      closeProductTour(true)
    } else {
      setStepIndex((prev) => prev + 1)
    }
  }, [stepIndex, activeSteps.length, closeProductTour])

  const handleBack = useCallback(() => {
    setStepIndex((prev) => Math.max(0, prev - 1))
  }, [])

  // Keyboard navigation: ArrowRight / Enter -> Next, ArrowLeft -> Back, Escape -> Skip
  useEffect(() => {
    if (!isProductTourOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeProductTour(true)
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        handleBack()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isProductTourOpen, handleNext, handleBack, closeProductTour])

  // Keep Next button focused for crisp keyboard accessibility
  useEffect(() => {
    if (!isProductTourOpen || !currentStep) return
    const timer = window.setTimeout(() => {
      nextButtonRef.current?.focus({ preventScroll: true })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [isProductTourOpen, currentStep])

  const layout = useMemo(() => {
    if (!geometry || !currentStep) return null
    const pad = currentStep.padding ?? 6
    const spotTop = Math.max(4, geometry.top - pad)
    const spotLeft = Math.max(4, geometry.left - pad)
    const spotWidth = geometry.width + pad * 2
    const spotHeight = geometry.height + pad * 2
    const spotCenterX = spotLeft + spotWidth / 2
    const spotCenterY = spotTop + spotHeight / 2

    const placement: 'top' | 'bottom' =
      currentStep.preferredPlacement === 'top' && spotTop > 250
        ? 'top'
        : currentStep.preferredPlacement === 'bottom' &&
            geometry.viewportHeight - (spotTop + spotHeight) > 250
          ? 'bottom'
          : spotCenterY > geometry.viewportHeight * 0.52
            ? 'top'
            : 'bottom'

    const cardWidth = Math.min(CARD_WIDTH, geometry.viewportWidth - VIEWPORT_MARGIN * 2)
    const unclampedLeft = spotCenterX - cardWidth / 2
    const cardLeft = Math.max(
      VIEWPORT_MARGIN,
      Math.min(unclampedLeft, geometry.viewportWidth - cardWidth - VIEWPORT_MARGIN)
    )

    const caretLeft = Math.max(22, Math.min(spotCenterX - cardLeft, cardWidth - 22))

    return {
      spotTop,
      spotLeft,
      spotWidth,
      spotHeight,
      spotRadius: currentStep.radius ?? 16,
      placement,
      cardWidth,
      cardLeft,
      cardTop: placement === 'bottom' ? spotTop + spotHeight + CARET_GAP : undefined,
      cardBottom:
        placement === 'top'
          ? geometry.viewportHeight - spotTop + CARET_GAP
          : undefined,
      caretLeft
    }
  }, [geometry, currentStep])

  if (!isProductTourOpen || !currentStep || !layout) return null

  const Icon = currentStep.icon
  const totalSteps = activeSteps.length
  const isFirst = stepIndex === 0
  const isLast = stepIndex === totalSteps - 1
  const progressPercent = ((stepIndex + 1) / totalSteps) * 100
  const formattedShortcut = currentStep.shortcut
    ? currentStep.shortcut === 'SPACE'
      ? 'SPACE'
      : formatPlatformShortcut(currentStep.shortcut)
    : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="DualAI Interactive Walkthrough"
      className="animate-glass-backdrop fixed inset-0 z-[100] select-none overflow-hidden"
    >
      {/* Click-blocker layer behind the spotlight ring so stray clicks don't trigger underlying buttons */}
      <div
        className="fixed inset-0"
        onClick={(e) => {
          e.stopPropagation()
        }}
        aria-hidden="true"
      />

      {/* Hardware-accelerated gliding spotlight cutout + Apple Liquid Glass focus ring */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed"
        style={{
          top: layout.spotTop,
          left: layout.spotLeft,
          width: layout.spotWidth,
          height: layout.spotHeight,
          borderRadius: layout.spotRadius,
          boxShadow:
            '0 0 0 9999px rgba(8, 8, 11, 0.74), 0 0 0 1.5px rgba(10, 132, 255, 0.9), 0 0 28px 2px rgba(10, 132, 255, 0.32)',
          transition:
            'top 360ms cubic-bezier(0.22, 1, 0.36, 1), left 360ms cubic-bezier(0.22, 1, 0.36, 1), width 360ms cubic-bezier(0.22, 1, 0.36, 1), height 360ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 360ms cubic-bezier(0.22, 1, 0.36, 1)'
        }}
      />

      {/* Gliding Apple Liquid Glass Walkthrough Card */}
      <div
        className="glass-sheet fixed rounded-[22px] p-4 text-left"
        style={{
          width: layout.cardWidth,
          left: layout.cardLeft,
          top: layout.cardTop,
          bottom: layout.cardBottom,
          transition:
            'left 360ms cubic-bezier(0.22, 1, 0.36, 1), top 360ms cubic-bezier(0.22, 1, 0.36, 1), bottom 360ms cubic-bezier(0.22, 1, 0.36, 1)'
        }}
      >
        {/* Directional Caret Arrow pointing to the highlighted control */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-[#19191f] ${
            layout.placement === 'bottom'
              ? '-top-[5px] border-l border-t border-white/[0.14]'
              : '-bottom-[5px] border-r border-b border-white/[0.14]'
          }`}
          style={{
            left: layout.caretLeft,
            transition: 'left 360ms cubic-bezier(0.22, 1, 0.36, 1)'
          }}
        />

        {/* Animated Content Container */}
        <div key={currentStep.id} className="animate-utterance space-y-3">
          {/* Header Row: Section Icon + Step Counter (1 / N) + Close */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent-steel/18 text-accent-steel border border-accent-steel/30">
                <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
                {currentStep.section}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <span className="rounded-full border border-white/[0.1] bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-white/80">
                {stepIndex + 1} / {totalSteps}
              </span>
              <button
                type="button"
                onClick={() => closeProductTour(true)}
                aria-label="Close guided tour"
                className="glass-control-hover flex h-6 w-6 items-center justify-center rounded-full text-white/45 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Smooth Progress Rail */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-accent-steel"
              style={{
                width: `${progressPercent}%`,
                transition: 'width 320ms cubic-bezier(0.22, 1, 0.36, 1)'
              }}
            />
          </div>

          {/* Step Title & Concise Explanation */}
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold tracking-tight text-white">
                {currentStep.title}
              </h3>
              {formattedShortcut && (
                <kbd className="shrink-0 rounded-md border border-white/[0.12] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-white/70">
                  {formattedShortcut}
                </kbd>
              )}
            </div>
            <p className="text-[12px] leading-relaxed text-white/65">{currentStep.description}</p>
          </div>

          {/* Footer Navigation: Skip | Back + Next / Get Started */}
          <div className="flex items-center justify-between pt-1.5 border-t border-white/[0.07]">
            <button
              type="button"
              onClick={() => closeProductTour(true)}
              className="rounded-full px-2 py-1 text-[11px] font-medium text-white/45 hover:text-white/85 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70"
            >
              Skip tour
            </button>

            <div className="flex items-center space-x-1.5">
              {!isFirst && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="glass-control-hover flex h-7 items-center space-x-1 rounded-full border border-white/[0.1] bg-white/[0.06] px-2.5 text-[11px] font-medium text-white/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70"
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                  <span>Back</span>
                </button>
              )}

              <button
                ref={nextButtonRef}
                type="button"
                onClick={handleNext}
                className="glass-cta-start flex h-7 items-center space-x-1 rounded-full px-3.5 text-[11px] font-semibold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-steel/70"
              >
                <span>{isLast ? 'Get Started' : 'Next'}</span>
                {isLast ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
