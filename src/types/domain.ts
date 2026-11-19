/**
 * DUALAI - Domain Engine Type Definitions
 * Specialized domain presets and terminology injection models.
 */

export type DomainId =
  | 'general'
  | 'medical'
  | 'legal'
  | 'technical'
  | 'business'

export interface DomainPreset {
  id: DomainId
  label: string
  shortLabel: string
  category: string
  description: string
  systemDirective: string
}

export const DOMAIN_PRESETS: Record<DomainId, DomainPreset> = {
  general: {
    id: 'general',
    label: 'General / Conference',
    shortLabel: 'General',
    category: 'Standard',
    description: 'Everyday conversations, bilateral meetings, and conference interpretation.',
    systemDirective:
      'Translate accurately and naturally, maintaining the speaker register, tone, and conversational context.'
  },
  medical: {
    id: 'medical',
    label: 'Medical / Clinical',
    shortLabel: 'Medical',
    category: 'Specialized',
    description: 'Inpatient, outpatient, pharmacology, anatomy, and clinical diagnostics.',
    systemDirective:
      'Strict adherence to clinical precision, ICD-10 terminology, anatomy, medication dosages, and surgical terms. Never summarize.'
  },
  legal: {
    id: 'legal',
    label: 'Legal / Courtroom',
    shortLabel: 'Legal',
    category: 'Specialized',
    description: 'Depositions, courtroom hearings, contract review, and sworn statements.',
    systemDirective:
      'Legally binding verbatim translation. Maintain exact phrasing of legal terms of art, objections, and evidentiary statements.'
  },
  technical: {
    id: 'technical',
    label: 'Technical / Engineering',
    shortLabel: 'Technical',
    category: 'Specialized',
    description: 'Software development, cloud systems, industrial engineering, and IT.',
    systemDirective:
      'Preserve code syntax, terminal commands, architecture jargon, and acronyms verbatim without awkward literal localization.'
  },
  business: {
    id: 'business',
    label: 'Business / Negotiation',
    shortLabel: 'Business',
    category: 'Standard',
    description: 'Commercial negotiations, financial disclosures, and executive summits.',
    systemDirective:
      'Preserve commercial nuances, contractual numbers, negotiation tone, and corporate financial terminology precisely.'
  }
}
