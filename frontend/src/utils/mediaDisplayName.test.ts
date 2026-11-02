import { describe, it, expect } from 'vitest'
import { mediaDisplayName } from './mediaDisplayName'

describe('mediaDisplayName', () => {
  it('drops the extension and turns separators into spaces', () => {
    expect(mediaDisplayName('forest_camp-30x20.webp')).toBe('forest camp 30x20')
  })

  it('keeps only the last path segment', () => {
    expect(mediaDisplayName('maps/Dungeons\\Crypt__Level 2.png')).toBe('Crypt Level 2')
  })

  it('falls back to the raw name when nothing would be left', () => {
    expect(mediaDisplayName('__.png')).toBe('__.png')
    expect(mediaDisplayName(null)).toBe('')
  })
})
