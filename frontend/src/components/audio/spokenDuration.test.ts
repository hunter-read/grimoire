import { describe, it, expect } from 'vitest'
import { spokenDuration } from './spokenDuration'

describe('spokenDuration', () => {
  it('spells minutes and seconds out', () => {
    expect(spokenDuration(65, 'en-US')).toBe('1 minute, 5 seconds')
  })

  it('includes hours and skips units that are zero', () => {
    expect(spokenDuration(3600 + 5, 'en-US')).toBe('1 hour, 5 seconds')
    expect(spokenDuration(7200, 'en-US')).toBe('2 hours')
  })

  it('reads nothing at all as zero seconds', () => {
    expect(spokenDuration(0, 'en-US')).toBe('0 seconds')
    expect(spokenDuration(null, 'en-US')).toBe('0 seconds')
    expect(spokenDuration(-3, 'en-US')).toBe('0 seconds')
  })

  it('uses the reader’s language', () => {
    expect(spokenDuration(65, 'de-DE')).toBe('1 Minute, 5 Sekunden')
  })
})
