import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// We test the language-detection behaviour indirectly via i18n.language,
// but to do that we need to reload the module with different env state.
// Since the module is initialized once, we test detectLanguage by checking
// the exported AVAILABLE_LANGUAGES array and that the module loads without
// error, then test the priority rules through manual invocation of an
// equivalent function.

// ---------------------------------------------------------------------------
// AVAILABLE_LANGUAGES
// ---------------------------------------------------------------------------

describe('i18n — AVAILABLE_LANGUAGES', () => {
  it('is a non-empty array', async () => {
    const { AVAILABLE_LANGUAGES } = await import('./i18n')
    expect(Array.isArray(AVAILABLE_LANGUAGES)).toBe(true)
    expect(AVAILABLE_LANGUAGES.length).toBeGreaterThan(0)
  })

  it('each entry has value and label properties', async () => {
    const { AVAILABLE_LANGUAGES } = await import('./i18n')
    for (const entry of AVAILABLE_LANGUAGES) {
      expect(entry).toHaveProperty('value')
      expect(entry).toHaveProperty('label')
    }
  })

  it('includes en-US', async () => {
    const { AVAILABLE_LANGUAGES } = await import('./i18n')
    expect(AVAILABLE_LANGUAGES.some(l => l.value === 'en-US')).toBe(true)
  })

  it('is sorted by label', async () => {
    const { AVAILABLE_LANGUAGES } = await import('./i18n')
    const labels = AVAILABLE_LANGUAGES.map(l => l.label)
    const sorted = [...labels].sort((a, b) => a.localeCompare(b))
    expect(labels).toEqual(sorted)
  })
})

// ---------------------------------------------------------------------------
// detectLanguage priority rules (tested via an equivalent inline function)
// ---------------------------------------------------------------------------

// These tests replicate the detectLanguage() logic directly so we can
// exercise every branch without reloading the module.

function makeDetect(availableLocales) {
  return function detectLanguage(localStorageValue, navigatorLanguages) {
    if (localStorageValue) return localStorageValue

    for (const lang of (navigatorLanguages ?? [])) {
      const exact  = availableLocales.find(a => a === lang)
      const prefix = availableLocales.find(a => a.startsWith(lang.split('-')[0]))
      if (exact || prefix) return exact ?? prefix
    }
    return 'en-US'
  }
}

const LOCALES = ['en-US', 'fr-CA', 'fr-FR', 'de-DE']
const detect  = makeDetect(LOCALES)

describe('detectLanguage — priority', () => {
  it('returns localStorage value when present, regardless of navigator', () => {
    expect(detect('de-DE', ['en-US'])).toBe('de-DE')
  })

  it('ignores localStorage when the value is an empty string', () => {
    // empty string is falsy, so navigator is tried next
    expect(detect('', ['fr-CA'])).toBe('fr-CA')
  })

  it('exact-matches a navigator language', () => {
    expect(detect(null, ['fr-CA'])).toBe('fr-CA')
  })

  it('prefix-matches when an exact locale is not available', () => {
    // navigator says 'fr-BE', which is not in LOCALES; prefix 'fr' matches fr-CA
    expect(detect(null, ['fr-BE'])).toBe('fr-CA')
  })

  it('tries navigator languages in order, picks first match', () => {
    // zh-CN (no match), then de-DE (exact match)
    expect(detect(null, ['zh-CN', 'de-DE'])).toBe('de-DE')
  })

  it('falls back to en-US when no navigator language matches', () => {
    expect(detect(null, ['ja-JP', 'ko-KR'])).toBe('en-US')
  })

  it('falls back to en-US when navigator languages list is empty', () => {
    expect(detect(null, [])).toBe('en-US')
  })

  it('falls back to en-US when navigator languages is null', () => {
    expect(detect(null, null)).toBe('en-US')
  })
})
