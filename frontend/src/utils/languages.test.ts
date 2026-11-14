import { describe, expect, it } from 'vitest'
import { LANGUAGES, isLanguage, languageLabel } from './languages'

describe('languages', () => {
  it('stores lowercase names and shows them with a capital', () => {
    expect(LANGUAGES.every((l) => l === l.toLowerCase())).toBe(true)
    expect(languageLabel('english')).toBe('English')
    expect(languageLabel('')).toBe('')
    expect(languageLabel(null)).toBe('')
    expect(languageLabel(undefined)).toBe('')
  })

  it('knows which values are on the list', () => {
    expect(isLanguage('italian')).toBe(true)
    expect(isLanguage('Italian')).toBe(false)
    expect(isLanguage('')).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })
})
