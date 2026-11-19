import React, { useEffect, useRef } from 'react'
import { X, BookOpen, Upload, FileText, Check } from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { DOMAIN_PRESETS } from '../../../../types/domain'

export const GlossaryModal: React.FC = () => {
  const { isGlossaryModalOpen, closeGlossaryModal, domainId } = useSession()
  const modalRef = useRef<HTMLDivElement>(null)

  const activeDomain = DOMAIN_PRESETS[domainId] || DOMAIN_PRESETS.general

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isGlossaryModalOpen) {
        closeGlossaryModal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isGlossaryModalOpen, closeGlossaryModal])

  if (!isGlossaryModalOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="glossary-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none"
    >
      <div
        ref={modalRef}
        className="w-full max-w-xl rounded-lg border border-surface-border bg-surface-panel p-5 shadow-2xl space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-border pb-3">
          <div className="flex items-center space-x-2.5">
            <BookOpen className="h-4 w-4 text-accent-steel" strokeWidth={1.5} />
            <div>
              <h2 id="glossary-modal-title" className="text-sm font-semibold text-text-primary">
                Custom Terminology & Glossaries
              </h2>
              <p className="text-[11px] text-text-muted">
                Active Domain Target: {activeDomain.label}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeGlossaryModal}
            className="rounded p-1 text-text-muted hover:bg-surface-active hover:text-text-primary transition"
            title="Close (Escape)"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-3 text-xs text-text-secondary">
          <p className="text-text-secondary leading-relaxed">
            Upload custom CSV or JSON dictionaries containing paired source and target terms. These
            rules are injected directly into the Gemini prompt pipeline to enforce proprietary or
            high-risk technical vocabulary.
          </p>

          {/* Upload Dropzone */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-surface-border bg-surface-base p-6 text-center hover:border-surface-border-subtle transition">
            <Upload className="h-6 w-6 text-text-muted mb-2" strokeWidth={1.5} />
            <span className="font-medium text-text-primary">Select terminology CSV / JSON file</span>
            <span className="text-[10px] text-text-muted mt-0.5">
              Format: source_term, target_term, notes (Max 2MB)
            </span>
          </div>

          {/* Active Preset Injection Rules */}
          <div className="rounded border border-surface-border bg-surface-base p-3 space-y-1 font-mono text-[11px]">
            <div className="flex items-center justify-between text-text-muted">
              <span>Active Directive:</span>
              <span className="text-accent-emerald flex items-center space-x-1">
                <Check className="h-3 w-3" strokeWidth={2} />
                <span>INJECTED</span>
              </span>
            </div>
            <p className="text-text-secondary text-[11px] font-sans italic mt-1">
              "{activeDomain.systemDirective}"
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 border-t border-surface-border pt-3">
          <button
            type="button"
            onClick={closeGlossaryModal}
            className="rounded border border-surface-border bg-surface-base px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-active hover:text-text-primary transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
