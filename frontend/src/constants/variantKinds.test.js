import { describe, it, expect } from 'vitest'
import { VARIANT_KINDS } from './variantKinds'

describe('VARIANT_KINDS', () => {
  it('matches the backend vocabulary exactly', () => {
    // Mirrors backend/models/variants.py — drift here silently sends the API a
    // kind it will reject.
    expect([...VARIANT_KINDS].sort()).toEqual(
      [
        'black-and-white',
        'form-fillable',
        'gridded',
        'gridless',
        'other',
        'printer-friendly',
        'single-page',
        'spreads',
        'version',
      ].sort()
    )
  })

  it('ends with the catch-all', () => {
    expect(VARIANT_KINDS[VARIANT_KINDS.length - 1]).toBe('other')
  })
})
