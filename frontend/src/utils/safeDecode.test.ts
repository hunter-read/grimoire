import { describe, it, expect } from 'vitest'
import { safeDecodeURIComponent, tryDecodeURIComponent } from './safeDecode'

describe('tryDecodeURIComponent', () => {
  it('decodes a well-formed value', () => {
    expect(tryDecodeURIComponent('abc%2Ddef%20x')).toBe('abc-def x')
  })

  it.each(['%E0%A4%A', '%', '100%', '%zz'])('gives null for the malformed %s', (value) => {
    expect(tryDecodeURIComponent(value)).toBeNull()
  })
})

describe('safeDecodeURIComponent', () => {
  it('decodes a well-formed value', () => {
    expect(safeDecodeURIComponent('Caf%C3%A9')).toBe('Café')
  })

  it('returns a malformed value unchanged', () => {
    expect(safeDecodeURIComponent('50%-off')).toBe('50%-off')
  })
})
