import { describe, it, expect } from 'vitest'
import gallerySubtitle from './gallerySubtitle'

// Stand-in for i18next's `t`: records which key was asked for and echoes the
// interpolation values, so the tests assert on key choice rather than wording.
const t = (key, opts) => `${key}:${JSON.stringify(opts)}`

describe('gallerySubtitle', () => {
  it('uses the plain subtitle when the filters hide nothing', () => {
    expect(gallerySubtitle(t, 'maps', { count: 7, total: 7 })).toBe('maps.subtitle:{"count":7}')
  })

  it('uses the filtered subtitle once counts diverge', () => {
    expect(gallerySubtitle(t, 'tokens', { count: 2, total: 13 })).toBe(
      'tokens.subtitleFiltered:{"count":2,"total":13}'
    )
  })

  it('reports a filter that matches nothing as 0 of the total', () => {
    expect(gallerySubtitle(t, 'audio', { count: 0, total: 4 })).toBe(
      'audio.subtitleFiltered:{"count":0,"total":4}'
    )
  })

  it('keeps the plain subtitle for an empty collection', () => {
    expect(gallerySubtitle(t, 'maps', { count: 0, total: 0 })).toBe('maps.subtitle:{"count":0}')
  })

  it('reports the collection size, not the loaded slice, while pages stream in', () => {
    // The whole point of the loading branch: with 500 of 10000 maps in, the
    // header must not read "500 maps in your collection" and then climb.
    expect(
      gallerySubtitle(t, 'maps', { count: 500, total: 500, loading: true, available: 10000 })
    ).toBe('maps.subtitle:{"count":10000}')
  })

  it('still reports what a filter matched while loading', () => {
    // Both halves of "x of y" grow together as pages land, so this stays honest.
    expect(
      gallerySubtitle(t, 'maps', { count: 12, total: 500, loading: true, available: 10000 })
    ).toBe('maps.subtitleFiltered:{"count":12,"total":500}')
  })

  it('falls back to the loaded total when the server total is not known yet', () => {
    expect(
      gallerySubtitle(t, 'tokens', { count: 40, total: 40, loading: true, available: 0 })
    ).toBe('tokens.subtitle:{"count":40}')
  })

  it('uses the plain count once loading finishes', () => {
    expect(
      gallerySubtitle(t, 'maps', { count: 10000, total: 10000, loading: false, available: 10000 })
    ).toBe('maps.subtitle:{"count":10000}')
  })
})
