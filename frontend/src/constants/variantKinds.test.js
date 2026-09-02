import { describe, it, expect } from 'vitest'
import { VARIANT_KINDS, VARIANT_KINDS_BY_TYPE, kindsFor } from './variantKinds'

describe('VARIANT_KINDS', () => {
  it('matches the backend vocabulary exactly', () => {
    // Mirrors backend/models/variants.py — drift here silently sends the API a
    // kind it will reject.
    expect([...VARIANT_KINDS].sort()).toEqual(
      [
        'black-and-white',
        'color-variation',
        'form-fillable',
        'gridded',
        'gridless',
        'image',
        'other',
        'printer-friendly',
        'remix',
        'single-page',
        'slowed',
        'sped-up',
        'spreads',
        'universal-vtt',
        'version',
        'video',
      ].sort()
    )
  })

  it('ends with the catch-all', () => {
    expect(VARIANT_KINDS[VARIANT_KINDS.length - 1]).toBe('other')
  })

  it('is the union of the per-type lists', () => {
    const union = new Set(Object.values(VARIANT_KINDS_BY_TYPE).flat())
    expect([...VARIANT_KINDS].sort()).toEqual([...union].sort())
  })
})

describe('VARIANT_KINDS_BY_TYPE', () => {
  // Mirrors VARIANT_KINDS_BY_TYPE in backend/models/variants.py. Kept as an
  // explicit table rather than derived, so a change on either side shows up
  // here as a failing assertion instead of passing silently.
  it('matches the backend per-collection vocabulary', () => {
    expect([...VARIANT_KINDS_BY_TYPE.book].sort()).toEqual([
      'black-and-white',
      'form-fillable',
      'other',
      'printer-friendly',
      'single-page',
      'spreads',
      'version',
    ])
    expect([...VARIANT_KINDS_BY_TYPE.map].sort()).toEqual([
      'black-and-white',
      'gridded',
      'gridless',
      'image',
      'other',
      'printer-friendly',
      'universal-vtt',
      'version',
      'video',
    ])
    expect([...VARIANT_KINDS_BY_TYPE.token].sort()).toEqual([
      'black-and-white',
      'color-variation',
      'other',
      'version',
    ])
    expect([...VARIANT_KINDS_BY_TYPE.audio].sort()).toEqual([
      'other',
      'remix',
      'slowed',
      'sped-up',
      'version',
    ])
  })

  it('offers version and other everywhere', () => {
    for (const kinds of Object.values(VARIANT_KINDS_BY_TYPE)) {
      expect(kinds).toContain('version')
      expect(kinds).toContain('other')
    }
  })

  it('keeps the map-only kinds off the other collections', () => {
    for (const kind of ['gridded', 'gridless', 'universal-vtt', 'video', 'image']) {
      expect(VARIANT_KINDS_BY_TYPE.map).toContain(kind)
      for (const type of ['book', 'token', 'audio']) {
        expect(VARIANT_KINDS_BY_TYPE[type]).not.toContain(kind)
      }
    }
  })

  it('keeps the book-only kinds off the other collections', () => {
    for (const kind of ['form-fillable', 'spreads', 'single-page']) {
      expect(VARIANT_KINDS_BY_TYPE.book).toContain(kind)
      for (const type of ['map', 'token', 'audio']) {
        expect(VARIANT_KINDS_BY_TYPE[type]).not.toContain(kind)
      }
    }
  })

  it('ends every list with the catch-all', () => {
    for (const kinds of Object.values(VARIANT_KINDS_BY_TYPE)) {
      expect(kinds[kinds.length - 1]).toBe('other')
    }
  })
})

describe('kindsFor', () => {
  it('returns the collection list', () => {
    expect(kindsFor('audio')).toEqual(VARIANT_KINDS_BY_TYPE.audio)
  })

  it('falls back to every kind for an unknown collection', () => {
    expect(kindsFor('')).toEqual(VARIANT_KINDS)
    expect(kindsFor('widget')).toEqual(VARIANT_KINDS)
  })

  it('appends a legacy kind the row already carries', () => {
    // A token filed as form-fillable before the vocabulary was scoped: the
    // select must be able to hold that value rather than silently showing
    // another one.
    const kinds = kindsFor('token', 'form-fillable')
    expect(kinds).toContain('form-fillable')
    expect(kinds).toEqual([...VARIANT_KINDS_BY_TYPE.token, 'form-fillable'])
  })

  it('does not duplicate a kind the collection already offers', () => {
    expect(kindsFor('map', 'gridless')).toEqual(VARIANT_KINDS_BY_TYPE.map)
  })

  it('ignores an empty current kind', () => {
    expect(kindsFor('token', '')).toEqual(VARIANT_KINDS_BY_TYPE.token)
  })
})
