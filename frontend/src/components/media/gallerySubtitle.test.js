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
})
