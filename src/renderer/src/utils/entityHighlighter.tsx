/**
 * DUALAI - High-Contrast Critical Entity Highlighter
 * Regex engine identifying and highlighting emails, phone numbers, clinical dosages,
 * medical units, monetary sums, currencies, percentages, and numerical measurements
 * in clean inline high-contrast bold (zero distracting inline boxes).
 */

import React from 'react'

const CRITICAL_ENTITY_REGEX = new RegExp(
  '(' +
    // 1. Email addresses (e.g., patient.name@gmail.com)
    '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b' +
    '|' +
    // 2. International & local phone numbers (e.g., +1 (555) 234-5678, 504-9988-7766, 555-0192)
    '(?:\\+?\\d{1,3}[\\s.-]?)?(?:\\(\\d{2,4}\\)[\\s.-]?|\\d{3,4}[\\s.-])\\d{3,4}(?:[\\s.-]\\d{3,4})?' +
    '|' +
    // 3. Medical dosages & clinical units (e.g., 500 mg, 10 ml, 2.5 mcg, 145/92 mm Hg)
    '\\b\\d+(?:\\.\\d+)?\\s*(?:mg|milligrams?|miligramos?|mcg|micrograms?|microgramos?|g|grams?|gramos?|ml|milliliters?|mililitros?|cc|units?|unidades?|IU|UI|mm\\s*Hg|bpm|latidos|°C|°F)\\b' +
    '|' +
    // 4. Clinical frequencies, anatomical codes & vital ratios (e.g., L4-L5, 145/92, q8h, PO, IV)
    '\\b[A-Z]\\d+-[A-Z]\\d+\\b|\\b\\d{2,3}\\s*\\/\\s*\\d{2,3}\\b|\\b(?:PO|IV|IM|SC|q8h|q12h|q4h|bid|tid|qid|prn|c/8h|c/12h)\\b' +
    '|' +
    // 5. Monetary sums, currencies & percentages (e.g., $1,500.00, 16%, 100,000 USD)
    '(?:\\$|€|£|¥)\\s*\\d+(?:,\\d{3})*(?:\\.\\d+)?|\\b\\d+(?:,\\d{3})*(?:\\.\\d+)?\\s*(?:USD|EUR|GBP|dollars?|dólares|euros?)\\b|\\b\\d+(?:\\.\\d+)?%' +
    '|' +
    // 6. Calendar dates & standalone numbers (e.g., 2026-11-25, 16000, 300)
    '\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d+(?:,\\d{3})*(?:\\.\\d+)?\\b' +
  ')',
  'gi'
)

export function highlightCriticalEntities(text: string): React.ReactNode[] {
  if (!text) return []

  const parts = text.split(CRITICAL_ENTITY_REGEX)

  return parts.map((part, index) => {
    if (!part) return null

    CRITICAL_ENTITY_REGEX.lastIndex = 0
    const isCritical = CRITICAL_ENTITY_REGEX.test(part)

    if (isCritical) {
      return (
        <strong
          key={`entity-${index}-${part}`}
          className="font-semibold text-amber-200 underline decoration-amber-500/40 underline-offset-2 select-text"
          title="Highlighted contact, dosage, or numerical entity"
        >
          {part}
        </strong>
      )
    }

    return (
      <span key={`text-${index}`} className="select-text">
        {part}
      </span>
    )
  })
}
