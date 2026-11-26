/**
 * DUALAI - Central Draggable Split Divider
 * Precision vertical divider providing smooth 50/50 resizing between Source and Target panes.
 * Enforces bounded percentages (25% to 75%), keyboard accessibility, and zero-flicker rendering.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { GripVertical } from 'lucide-react'

interface SplitDividerProps {
  splitRatio: number
  onSplitChange: (newRatio: number) => void
  onSplitCommit: (finalRatio: number) => void
  containerRef: React.RefObject<HTMLDivElement | null>
  minPercent?: number
  maxPercent?: number
}

export const SplitDivider: React.FC<SplitDividerProps> = ({
  splitRatio,
  onSplitChange,
  onSplitCommit,
  containerRef,
  minPercent = 25,
  maxPercent = 75
}) => {
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let delta = 0
      if (e.key === 'ArrowLeft') delta = -2
      else if (e.key === 'ArrowRight') delta = 2
      else if (e.key === 'Home') {
        onSplitChange(50)
        onSplitCommit(50)
        return
      }

      if (delta !== 0) {
        e.preventDefault()
        const newRatio = Math.max(minPercent, Math.min(maxPercent, splitRatio + delta))
        onSplitChange(newRatio)
        onSplitCommit(newRatio)
      }
    },
    [splitRatio, minPercent, maxPercent, onSplitChange, onSplitCommit]
  )

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const offsetX = e.clientX - rect.left
      const rawPercent = (offsetX / rect.width) * 100
      const clampedPercent = Math.max(minPercent, Math.min(maxPercent, rawPercent))

      requestAnimationFrame(() => {
        onSplitChange(Math.round(clampedPercent * 10) / 10)
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      onSplitCommit(splitRatio)
    }

    // Set cursor on body to prevent cursor flicker across panes during drag
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, containerRef, minPercent, maxPercent, splitRatio, onSplitChange, onSplitCommit])

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Dual-pane split workspace divider"
      aria-valuenow={Math.round(splitRatio)}
      aria-valuemin={minPercent}
      aria-valuemax={maxPercent}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      className={`relative w-3 -mx-1.5 flex flex-col items-center justify-center cursor-col-resize z-20 group outline-none select-none transition-colors ${
        isDragging ? 'bg-accent-steel/15' : 'hover:bg-white/[0.03]'
      }`}
    >
      {/* Optical Hairline Divider */}
      <div
        className={`w-px h-full transition-colors duration-200 ${
          isDragging ? 'bg-accent-steel' : 'bg-white/[0.06] group-hover:bg-white/[0.22]'
        }`}
      />

      {/* Frosted Liquid Glass Grip Pill (Appears softly on hover/drag) */}
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-8 rounded-full border flex items-center justify-center transition-all duration-200 ${
          isDragging
            ? 'bg-accent-steel text-white border-accent-steel scale-105 opacity-100 shadow-lg'
            : 'glass-capsule text-white/60 opacity-0 group-hover:opacity-100 group-focus:opacity-100'
        }`}
        title={`Split divider: ${Math.round(splitRatio)}% / ${100 - Math.round(splitRatio)}% (Drag or use arrow keys)`}
      >
        <GripVertical className="h-2.5 w-2.5" strokeWidth={2} />
      </div>
    </div>
  )
}
