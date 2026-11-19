/**
 * DUALAI - Language Type Definitions & Supported Language Registry
 * Strict ISO 639-1 / BCP 47 compliant models for dual-pane interpretation.
 */

export interface SupportedLanguage {
  code: string
  isoName: string
  displayName: string
  nativeName: string
  isCommonPair: boolean
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', isoName: 'EN - English', displayName: 'English (US/UK)', nativeName: 'English', isCommonPair: true },
  { code: 'es', isoName: 'ES - Spanish', displayName: 'Spanish (Latin America/Spain)', nativeName: 'Español', isCommonPair: true },
  { code: 'pt', isoName: 'PT - Portuguese', displayName: 'Portuguese (Brazil/Portugal)', nativeName: 'Português', isCommonPair: true },
  { code: 'fr', isoName: 'FR - French', displayName: 'French (France/Canada)', nativeName: 'Français', isCommonPair: true },
  { code: 'de', isoName: 'DE - German', displayName: 'German (Standard)', nativeName: 'Deutsch', isCommonPair: true },
  { code: 'it', isoName: 'IT - Italian', displayName: 'Italian', nativeName: 'Italiano', isCommonPair: true },
  { code: 'zh', isoName: 'ZH - Chinese', displayName: 'Chinese (Mandarin Simplified)', nativeName: '中文 (简体)', isCommonPair: true },
  { code: 'ja', isoName: 'JA - Japanese', displayName: 'Japanese', nativeName: '日本語', isCommonPair: true },
  { code: 'ko', isoName: 'KO - Korean', displayName: 'Korean', nativeName: '한국어', isCommonPair: true },
  { code: 'ar', isoName: 'AR - Arabic', displayName: 'Arabic (Modern Standard)', nativeName: 'العربية', isCommonPair: false },
  { code: 'ru', isoName: 'RU - Russian', displayName: 'Russian', nativeName: 'Русский', isCommonPair: false },
  { code: 'nl', isoName: 'NL - Dutch', displayName: 'Dutch', nativeName: 'Nederlands', isCommonPair: false },
  { code: 'pl', isoName: 'PL - Polish', displayName: 'Polish', nativeName: 'Polski', isCommonPair: false },
  { code: 'tr', isoName: 'TR - Turkish', displayName: 'Turkish', nativeName: 'Türkçe', isCommonPair: false }
]

export interface LanguagePair {
  sourceLang: string
  targetLang: string
}
