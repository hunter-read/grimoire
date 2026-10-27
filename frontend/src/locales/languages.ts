/**
 * Every locale under src/locales/, by code, with the name its `_meta.nativeName`
 * gives it. Listed here rather than read from the files so the language picker
 * can name them all without loading them (issue #708). A locale missing from
 * this list fails `languages.test.ts`.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  'de-DE': 'Deutsch (DE)',
  'en-CA': 'English (Canada)',
  'en-US': 'English (US)',
  'es-ES': 'Español (ES)',
  'es-MX': 'Español (MX)',
  'fr-CA': 'Français (CA)',
  'fr-FR': 'Français (FR)',
  'it-IT': 'Italiano (IT)',
  'nl-NL': 'Nederlands (NL)',
  'pt-BR': 'Português (BR)',
  'pt-PT': 'Português (PT)',
  'sv-SE': 'Svenska (SE)',
}
