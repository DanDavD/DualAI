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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 select-none"
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
            Upload custom CSV or JSON dictionaries containing paired source and target terms. Validated
            entries are injected immediately into the Gemini 2.0 Flash prompt pipeline.
          </p>

          {/* Upload Dropzone */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-surface-border bg-surface-base p-5 text-center space-y-2">
            <Upload className="h-5 w-5 text-accent-steel" strokeWidth={1.5} />
            <span className="font-medium text-text-primary">Select terminology CSV / JSON file</span>
            <span className="text-[10px] font-mono text-text-muted">
              Format: source_term, target_term, notes (Max 2MB)
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={(e) => void handleFileChange(e)}
              className="hidden"
            />
            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                onClick={handleLoadSample}
                className="rounded border border-surface-border bg-surface-panel px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:text-text-primary transition"
              >
                Load Sample CSV
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded bg-accent-steel px-3 py-1 font-mono text-[11px] font-semibold text-white hover:bg-blue-700 transition"
              >
                Choose File
              </button>
            </div>
          </div>

          {validation && (
            <div
              className={`rounded border p-2.5 font-mono text-[11px] ${
                validation.isValid
                  ? 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald'
                  : 'border-accent-crimson/40 bg-accent-crimson/10 text-accent-crimson'
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
            <div className="max-h-32 overflow-y-auto rounded border border-surface-border bg-surface-base divide-y divide-surface-border-subtle font-mono text-[11px]">
              {customGlossaryEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between px-3 py-1.5">
                  <span>
                    <strong className="text-text-primary">{entry.source}</strong>{' '}
                    <span className="text-text-muted">-&gt;</span>{' '}
                    <strong className="text-accent-emerald">{entry.target}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGlossaryEntry(entry.id)}
                    className="text-text-muted hover:text-accent-crimson"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Active Preset Injection Rules */}
          <div className="rounded border border-surface-border bg-surface-base p-3 space-y-1 font-mono text-[11px]">
            <div className="flex items-center justify-between text-text-muted">
              <span>Active Directive ({customGlossaryEntries.length} custom terms):</span>
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
