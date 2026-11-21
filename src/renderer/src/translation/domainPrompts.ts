/**
 * DUALAI - Domain Prompt Injection & System Directives
 * Specialized prompt templates enforcing ICD-10 anatomical directives,
 * verbatim legal terms of art, technical vocabulary preservation,
 * and bidirectional dialogue history context memory.
 */

import { DomainId } from '../../../types/domain'
import { DialogueTurn } from '../../../types/translation'

export interface PromptBuildParams {
  domainId: DomainId
  sourceLang: string
  targetLang: string
  sourceText: string
  speakerLabel: string
  dialogueHistory: DialogueTurn[]
  customGlossary?: Record<string, string>
}

const DOMAIN_SYSTEM_DIRECTIVES: Record<DomainId, string> = {
  medical: `DOMAIN: CLINICAL MEDICINE & PHARMACOLOGY (ICD-10 DIRECTIVE)
- Strictly adhere to official clinical terminology, anatomical directives, and ICD-10 diagnostic nomenclature.
- Translate medical terms with anatomical precision:
  * "dyspnea" -> "disnea"
  * "tachycardia" / "acute tachycardia" -> "taquicardia" / "taquicardia aguda"
  * "myocardial infarction" -> "infarto agudo de miocardio"
  * "lumbar disc herniation" -> "hernia de disco lumbar"
  * "amoxicillin" -> "amoxicilina"
  * "blood pressure" -> "presión arterial"
  * "intravenous" / "IV" -> "intravenoso" / "IV"
- Translate exact medication dosages, units, and frequencies verbatim (e.g. "500 mg every 8 hours" -> "500 mg cada 8 horas").
- Never soften, colloquialize, or summarize diagnoses, symptoms, or surgical procedures.`,

  legal: `DOMAIN: LEGAL PROCEEDINGS & JURISPRUDENCE (VERBATIM DIRECTIVE)
- Legally binding verbatim translation. Translate legal terms of art using formal statutory equivalents without colloquialism.
- Exact terminology directives:
  * "party of the first part" -> "la parte de la primera parte"
  * "indemnify and hold harmless" -> "indemnizar y eximir de responsabilidad"
  * "hearsay" / "hearsay testimony" -> "prueba de referencia" / "testimonio de oídas"
  * "statutory jurisdiction" -> "jurisdicción estatutaria"
  * "sworn affidavit" -> "declaración jurada"
  * "objection sustained" / "overruled" -> "objeción ha lugar" / "no ha lugar"
  * "breach of contract" -> "incumplimiento de contrato"
- Never rephrase, interpret, or soften objections, evidentiary claims, or testimony.`,

  technical: `DOMAIN: SOFTWARE ENGINEERING & SYSTEMS (TECHNICAL DIRECTIVE)
- Preserve code syntax, system calls, CLI commands, architecture terms, and acronyms verbatim.
- Retain technical terminology without awkward literal localization:
  * "WebSockets", "ArrayBuffer", "linear16 PCM", "SIMD", "ring buffer", "VAD", "daemon", "endpoint".
- Preserve data structures, error codes, and metric units exactly as stated.`,

  business: `DOMAIN: COMMERCIAL ENTERPRISE & FINANCE (BUSINESS DIRECTIVE)
- Preserve commercial nuances, executive negotiation register, and corporate governance terminology.
- Accurate translation of quarterly earnings, percentages, liabilities, EBITDA, mergers, covenants, and monetary sums.
- Maintain professional executive decorum and diplomatic negotiation posture.`,

  general: `DOMAIN: BILATERAL CONFERENCE (GENERAL DIRECTIVE)
- Translate faithfully, accurately, and fluently, preserving the speaker's conversational register, tone, and cultural nuance.
- Maintain bidirectional dialogue continuity and natural linguistic cadence.`
}

export function buildDomainSystemInstruction(domainId: DomainId): string {
  const directive = DOMAIN_SYSTEM_DIRECTIVES[domainId] || DOMAIN_SYSTEM_DIRECTIVES.general

  return `You are DUALAI, an enterprise real-time simultaneous interpretation engine designed for specialized professional environments.

${directive}

OPERATIONAL CONSTRAINTS:
1. Output ONLY the raw translated text. Do not prepend labels, quotes, explanations, markdown formatting, or introductory commentary.
2. Maintain exact numbers, measurements, proper nouns, and entity designations.
3. Preserve the exact grammatical person and voice of the speaker.`
}

export function buildPromptWithContext(params: PromptBuildParams): string {
  const {
    sourceLang,
    targetLang,
    sourceText,
    speakerLabel,
    dialogueHistory,
    customGlossary
  } = params

  let prompt = ''

  // Inject Custom Glossary if defined
  if (customGlossary && Object.keys(customGlossary).length > 0) {
    prompt += `[MANDATORY DOMAIN GLOSSARY TERMS]:\n`
    for (const [sourceTerm, targetTerm] of Object.entries(customGlossary)) {
      prompt += `- "${sourceTerm}" MUST be translated as "${targetTerm}"\n`
    }
    prompt += `\n`
  }

  // Inject Bidirectional Context Memory (Last 6 turns for pronoun & antecedent continuity)
  if (dialogueHistory && dialogueHistory.length > 0) {
    const recentHistory = dialogueHistory.slice(-6)
    prompt += `[CONVERSATION CONTEXT HISTORY (Bidirectional Dialogue Memory)]:\n`
    for (const turn of recentHistory) {
      prompt += `${turn.speakerLabel} (${turn.sourceLang.toUpperCase()}): "${turn.sourceText}" -> (${turn.targetLang.toUpperCase()}): "${turn.translatedText}"\n`
    }
    prompt += `\n`
  }

  // Current Translation Task
  prompt += `[TRANSLATE CURRENT UTTERANCE]:
Speaker: ${speakerLabel}
Source Language: ${sourceLang.toUpperCase()}
Target Language: ${targetLang.toUpperCase()}
Source Text: "${sourceText}"
Translation:`

  return prompt
}
