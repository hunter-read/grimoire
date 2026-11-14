/**
 * The languages a book can be written in: a fixed list, stored lowercase ("english") and shown
 * with a capital ("English"). Mirrors backend/models/languages.py (a backend test checks they
 * agree), which resolves any other spelling ("en", "Deutsch") before storing.
 */
export const LANGUAGES = [
  'arabic',
  'catalan',
  'chinese',
  'czech',
  'danish',
  'dutch',
  'english',
  'finnish',
  'french',
  'german',
  'greek',
  'hebrew',
  'hungarian',
  'indonesian',
  'italian',
  'japanese',
  'korean',
  'norwegian',
  'polish',
  'portuguese',
  'romanian',
  'russian',
  'slovak',
  'spanish',
  'swedish',
  'turkish',
  'ukrainian',
] as const

export type Language = (typeof LANGUAGES)[number]

/** "english" -> "English". Blank stays blank. */
export function languageLabel(value: string | null | undefined): string {
  const v = value ?? ''
  return v.charAt(0).toUpperCase() + v.slice(1)
}

/** Whether `value` is one of the listed languages, as stored. */
export function isLanguage(value: string | null | undefined): value is Language {
  return (LANGUAGES as readonly string[]).includes(value ?? '')
}
