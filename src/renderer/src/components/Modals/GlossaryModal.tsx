import React, { useEffect, useRef, useState } from 'react'
import { X, BookOpen, Upload, Check, AlertCircle, Trash2 } from 'lucide-react'
import { useSession } from '../../context/SessionContext'
import { DOMAIN_PRESETS } from '../../../../types/domain'
import { GlossaryValidationResult } from '../../../../types/settings'
import { parseGlossaryFile, SAMPLE_GLOSSARY_CSV } from '../../utils/glossaryParser'

export const GlossaryModal: React.FC = () => {
  const {
    isGlossaryModalOpen,
    closeGlossaryModal,
    domainId,
    customGlossaryEntries,
    importGlossaryEntries,
    removeGlossaryEntry
  } = useSession()
  const modalRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [validation, setValidation] = useState<GlossaryValidationResult | null>(null)

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const result = parseGlossaryFile(file.name, text)
    setValidation(result)
    if (result.entries.length > 0) {
      importGlossaryEntries(result.entries, false)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleLoadSample = () => {
    const result = parseGlossaryFile('sample.csv', SAMPLE_GLOSSARY_CSV)
    setValidation(result)
    if (result.entries.length > 0) {
      importGlossaryEntries(result.entries, false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="glossary-modal-title"
      className="animate-glass-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4 select-none"
    >
      <div
        ref={modalRef}
        className="glass-sheet animate-glass-modal w-full max-w-xl rounded-[24px] p-5 space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
          <div className="flex items-center space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-steel/20 text-accent-steel">
              <BookOpen className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div>
              <h2 id="glossary-modal-title" className="text-sm font-semibold tracking-tight text-white">
                Custom Terminology & Glossaries
              </h2>
              <p className="text-[11px] text-white/50">
                Active Domain: {activeDomain.label}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeGlossaryModal}
            className="glass-control-hover flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-white/60 hover:text-white"
            title="Close (Escape)"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-3.5 text-xs text-white/70">
          <p className="leading-relaxed">
            Upload custom CSV or JSON dictionaries containing paired source and target terms. Validated
            entries are applied immediately during live interpretation.
          </p>

          {/* Upload Dropzone */}
          <div className="glass-grouped-card flex flex-col items-center justify-center rounded-2xl border-dashed border-white/[0.15] p-5 text-center space-y-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-steel/18 text-accent-steel">
              <Upload className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <span className="font-semibold text-white">Select terminology CSV or JSON file</span>
            <span className="font-mono text-[10px] text-white/45">
              Format: source_term, target_term, notes (Max 2MB)
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={(e) => void handleFileChange(e)}
              className="hidden"
            />
            <div className="flex items-center space-x-2 pt-1.5">
              <button
                type="button"
                onClick={handleLoadSample}
                className="glass-control-hover rounded-full border border-white/[0.1] bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-medium text-white/80 hover:text-white"
              >
                Load Sample CSV
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="glass-cta-start rounded-full px-4 py-1.5 text-[11px] font-semibold"
              >
                Choose File
              </button>
            </div>
          </div>

          {validation && (
            <div
              className={`rounded-2xl border p-3 text-[11px] ${
                validation.isValid
                  ? 'border-accent-emerald/40 bg-accent-emerald/12 text-accent-emerald'
                  : 'border-accent-crimson/40 bg-accent-crimson/12 text-accent-crimson'
              }`}
            >
              {validation.isValid ? (
                <span className="flex items-center space-x-1.5">
                  <Check className="h-3.5 w-3.5" />
                  <span>Validated and injected {validation.entries.length} term(s).</span>
                </span>
              ) : (
                <span className="flex items-center space-x-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{validation.errors[0]}</span>
                </span>
              )}
            </div>
          )}

          {/* Active Terms List */}
          {customGlossaryEntries.length > 0 && (
            <div className="glass-grouped-card max-h-36 overflow-y-auto rounded-2xl divide-y divide-white/[0.06] text-[11px]">
              {customGlossaryEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between px-3.5 py-2">
                  <span>
                    <strong className="text-white font-medium">{entry.source}</strong>{' '}
                    <span className="text-white/35 mx-1">{'->'}</span>{' '}
                    <strong className="text-accent-emerald font-medium">{entry.target}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGlossaryEntry(entry.id)}
                    className="glass-control-hover rounded-full p-1 text-white/45 hover:text-accent-crimson"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Active Preset Directive */}
          <div className="glass-grouped-card rounded-2xl p-3.5 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between text-white/50">
              <span>Active Directive ({customGlossaryEntries.length} custom terms)</span>
              <span className="rounded-full bg-accent-emerald/15 px-2 py-0.5 text-[10px] font-medium text-accent-emerald flex items-center space-x-1">
                <Check className="h-3 w-3" strokeWidth={2} />
                <span>Active</span>
              </span>
            </div>
            <p className="text-white/75 text-[11px] italic leading-relaxed">
              "{activeDomain.systemDirective}"
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-white/[0.08] pt-3">
          <button
            type="button"
            onClick={closeGlossaryModal}
            className="glass-control-hover rounded-full border border-white/[0.1] bg-white/[0.07] px-4 py-1.5 text-xs font-medium text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
