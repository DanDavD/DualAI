/**
 * DUALAI - Custom Glossary CSV/JSON Parser & Validator (Day 11)
 * Parses and validates uploaded CSV or JSON terminology dictionaries,
 * enforces syntax and size constraints, and builds prompt injection maps
 * for the Gemini 2.0 Flash domain inference pipeline.
 */

import { GlossaryEntry, GlossaryValidationResult } from '../../../types/settings'

const MAX_GLOSSARY_BYTES = 2 * 1024 * 1024 // 2 MB ceiling

/**
 * Parse a single CSV line handling RFC 4180 double-quoted fields and escaped quotes.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }

  fields.push(current.trim())
  return fields
}

export function parseCsvGlossary(rawText: string): GlossaryValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const entries: GlossaryEntry[] = []

  const byteSize = new TextEncoder().encode(rawText).length
  if (byteSize > MAX_GLOSSARY_BYTES) {
    return {
      isValid: false,
      entries: [],
      errors: [`File exceeds maximum allowed size of 2MB (${(byteSize / 1024 / 1024).toFixed(2)}MB).`],
      warnings: [],
      totalRowsParsed: 0,
      duplicateCount: 0
    }
  }

  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))

  if (lines.length === 0) {
    return {
      isValid: false,
      entries: [],
      errors: ['CSV content is empty. Expected rows in format: source_term, target_term, notes'],
      warnings: [],
      totalRowsParsed: 0,
      duplicateCount: 0
    }
  }

  let startIndex = 0
  const firstFields = parseCsvLine(lines[0]).map((f) => f.toLowerCase())
  if (
    firstFields.length >= 2 &&
    (firstFields[0].includes('source') || firstFields[0] === 'term' || firstFields[0] === 'origen') &&
    (firstFields[1].includes('target') || firstFields[1].includes('translation') || firstFields[1] === 'destino')
  ) {
    startIndex = 1
  }

  const seenKeys = new Set<string>()
  let duplicateCount = 0
  let totalRowsParsed = 0

  for (let i = startIndex; i < lines.length; i++) {
    const lineNum = i + 1
    totalRowsParsed++
    const fields = parseCsvLine(lines[i])

    if (fields.length < 2) {
      errors.push(`Line ${lineNum}: Invalid syntax. Expected at least 2 comma-separated columns (source_term, target_term).`)
      continue
    }

    const source = fields[0]
    const target = fields[1]
    const notes = fields[2] || undefined

    if (!source || !target) {
      errors.push(`Line ${lineNum}: Both source_term and target_term must be non-empty.`)
      continue
    }

    const normalizedKey = source.toLowerCase()
    if (seenKeys.has(normalizedKey)) {
      duplicateCount++
      warnings.push(`Line ${lineNum}: Duplicate source term "${source}" skipped.`)
      continue
    }

    seenKeys.add(normalizedKey)
    entries.push({
      id: `gloss-${Date.now()}-${i}`,
      source,
      target,
      notes
    })
  }

  if (entries.length === 0 && errors.length === 0) {
    errors.push('No valid terminology pairs were extracted from the CSV file.')
  }

  return {
    isValid: errors.length === 0 && entries.length > 0,
    entries,
    errors,
    warnings,
    totalRowsParsed,
    duplicateCount
  }
}

export function parseJsonGlossary(rawText: string): GlossaryValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const entries: GlossaryEntry[] = []

  const byteSize = new TextEncoder().encode(rawText).length
  if (byteSize > MAX_GLOSSARY_BYTES) {
    return {
      isValid: false,
      entries: [],
      errors: [`JSON file exceeds maximum allowed size of 2MB.`],
      warnings: [],
      totalRowsParsed: 0,
      duplicateCount: 0
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch (err) {
    return {
      isValid: false,
      entries: [],
      errors: [`Invalid JSON syntax: ${(err as Error).message}`],
      warnings: [],
      totalRowsParsed: 0,
      duplicateCount: 0
    }
  }

  const seenKeys = new Set<string>()
  let duplicateCount = 0
  let totalRowsParsed = 0

  if (Array.isArray(parsed)) {
    parsed.forEach((item, idx) => {
      totalRowsParsed++
      if (typeof item !== 'object' || item === null) {
        errors.push(`Entry #${idx + 1}: Expected an object with "source" and "target" properties.`)
        return
      }
      const record = item as Record<string, unknown>
      const source = typeof record.source === 'string' ? record.source.trim() : ''
      const target = typeof record.target === 'string' ? record.target.trim() : ''
      const notes = typeof record.notes === 'string' ? record.notes.trim() : undefined

      if (!source || !target) {
        errors.push(`Entry #${idx + 1}: Missing non-empty "source" or "target" string field.`)
        return
      }

      const normalizedKey = source.toLowerCase()
      if (seenKeys.has(normalizedKey)) {
        duplicateCount++
        warnings.push(`Entry #${idx + 1}: Duplicate source term "${source}" skipped.`)
        return
      }

      seenKeys.add(normalizedKey)
      entries.push({
        id: `gloss-json-${Date.now()}-${idx}`,
        source,
        target,
        notes
      })
    })
  } else if (typeof parsed === 'object' && parsed !== null) {
    const record = parsed as Record<string, unknown>
    Object.entries(record).forEach(([key, val], idx) => {
      totalRowsParsed++
      const source = key.trim()
      const target = typeof val === 'string' ? val.trim() : ''

      if (!source || !target) {
        errors.push(`Key "${key}": Value must be a non-empty string translation.`)
        return
      }

      const normalizedKey = source.toLowerCase()
      if (seenKeys.has(normalizedKey)) {
        duplicateCount++
        return
      }

      seenKeys.add(normalizedKey)
      entries.push({
        id: `gloss-map-${Date.now()}-${idx}`,
        source,
        target
      })
    })
  } else {
    errors.push('JSON root must be an array of { source, target } objects or a key-value map.')
  }

  return {
    isValid: errors.length === 0 && entries.length > 0,
    entries,
    errors,
    warnings,
    totalRowsParsed,
    duplicateCount
  }
}

export function parseGlossaryFile(filename: string, rawText: string): GlossaryValidationResult {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
    return parseJsonGlossary(rawText)
  }
  return parseCsvGlossary(rawText)
}

export function glossaryEntriesToMap(entries: GlossaryEntry[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.source && entry.target) {
      map[entry.source] = entry.target
    }
  }
  return map
}

export const SAMPLE_GLOSSARY_CSV = `source_term,target_term,notes
dyspnea,disnea,ICD-10 R06.0
acute tachycardia,taquicardia aguda,Cardiology
indemnify and hold harmless,indemnizar y eximir de responsabilidad,Contractual verbatim
hearsay testimony,prueba de referencia,Evidentiary objection
amoxicillin,amoxicilina,Beta-lactam antibiotic`
