import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../api', () => ({ mediaUrl: (path: string) => `/api${path}` }))

import { buildRecipe, librarySource } from './tokenRecipe'

const settings = {
  size: 512,
  frameId: 'generic:circle',
  frameColor: 'gold',
  background: '',
  transform: { scale: 2, offsetX: 1, offsetY: 2, rotation: 45, flipX: false, flipY: true },
}

describe('buildRecipe', () => {
  it('has nothing to keep for art it cannot point back to', () => {
    expect(buildRecipe(null, settings)).toBeNull()
  })

  it('references a library source by id', () => {
    const out = buildRecipe({ type: 'map', id: 'map-1' }, settings)
    expect(out).toEqual({
      recipe: {
        size: 512,
        frame_id: 'generic:circle',
        frame_color: 'gold',
        background: '',
        transform: settings.transform,
        source: { type: 'map', id: 'map-1' },
      },
      source: null,
    })
  })

  it('carries device art itself', () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const out = buildRecipe({ type: 'upload', blob }, settings)
    expect(out?.recipe.source).toEqual({ type: 'upload', id: null })
    expect(out?.source).toBe(blob)
  })

  it('copies the transform rather than sharing it', () => {
    const out = buildRecipe({ type: 'token', id: 't' }, settings)
    expect(out?.recipe.transform).not.toBe(settings.transform)
  })
})

describe('librarySource', () => {
  it('points a token or map at its full-resolution file', () => {
    expect(librarySource({ type: 'token', id: 't1' })).toEqual({
      ref: { type: 'token', id: 't1' },
      url: '/api/tokens/t1/file',
    })
    expect(librarySource({ type: 'map', id: 'm1' })?.url).toBe('/api/maps/m1/file')
  })

  it('is null for kept device art, or a library source with no id', () => {
    expect(librarySource({ type: 'upload', id: null })).toBeNull()
    expect(librarySource({ type: 'token', id: null })).toBeNull()
  })
})
