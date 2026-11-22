/**
 * DUALAI - High-Contrast Critical Entity Highlighter
 * Regex engine identifying and highlighting clinical dosages, medical units,
 * monetary sums, currencies, percentages, and numerical measurements in high-contrast bold.
 * Prevents catastrophic misinterpretation of vital clinical and legal data.
 */

import React from 'react'

// Master entity recognition regex pattern
const CRITICAL_ENTITY_REGEX = new RegExp(
  '(' +
    // 1. Medical dosages & clinical units (e.g., 500 mg, 10 ml, 2.5 mcg, 145/92 mm Hg)
    '\\b\\d+(?:\\.\\d+)?\\s*(?:mg|milligrams?|miligramos?|mcg|micrograms?|microgramos?|g|grams?|gramos?|ml|milliliters?|mililitros?|cc|units?|unidades?|IU|UI|mm\\s*Hg|bpm|latidos|°C|°F)\\b' +
    '|' +
    // 2. Clinical frequencies, anatomical codes & vital ratios (e.g., L4-L5, 145/92, q8h, PO, IV)
    '\\b[A-Z]\\d+-[A-Z]\\d+\\b|\\b\\d{2,3}\\s*\\/\\s*\\d{2,3}\\b|\\b(?:PO|IV|IM|SC|q8h|q12h|q4h|bid|tid|qid|prn|c/8h|c/12h)\\b' +
    '|' +
    // 3. Monetary sums, currencies & percentages (e.g., $1,500.00, €250, 16%, 100,000 USD)
    '(?:\\$|€|£|¥)\\s*\\d+(?:,\\d{3})*(?:\\.\\d+)?|\\b\\d+(?:,\\d{3})*(?:\\.\\d+)?\\s*(?:USD|EUR|GBP|dollars?|dólares|euros?)\\b|\\b\\d+(?:\\.\\d+)?%' +
    '|' +
    // 4. Standalone numerical figures & calendar dates (e.g., 2026-11-25, 16000, 300)
    '\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d+(?:,\\d{3})*(?:\\.\\d+)?\\b' +
  ')',
  'gi'
)

export function highlightCriticalEntities(text: string): React.ReactNode[] {
  if (!text) return []

  const parts = text.split(CRITICAL_ENTITY_REGEX)

  return parts.map((part, index) => {
    if (!part) return null

    // Reset lastIndex for stateful regex testing
    CRITICAL_ENTITY_REGEX.lastIndex = 0
    const isCritical = CRITICAL_ENTITY_REGEX.test(part)

    if (isCritical) {
      return (
        <strong
          key={`entity-${index}-${part}`}
          className="font-mono font-bold text-amber-300 bg-amber-950/40 px-1 py-0.5 rounded border border-amber-500/40 mx-0.5 inline-block text-[13px] tracking-tight select-text"
          title="Critical clinical or numerical entity highlighted by safety directive"
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
