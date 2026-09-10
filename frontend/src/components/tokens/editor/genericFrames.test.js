import { describe, it, expect } from 'vitest'

import {
  DEFAULT_FRAME_COLOR,
  GENERIC_SHAPES,
  genericFrameUrl,
  genericShape,
  isGenericFrame,
} from './genericFrames'
import { ICON_COLOR_PRESETS } from '../../campaigns/iconColors'

/** Decode a data-URI SVG back to markup so its contents can be asserted. */
const decode = (url) => decodeURIComponent(url.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''))

describe('GENERIC_SHAPES', () => {
  it('offers a circle, a square, and a hexagon', () => {
    expect(GENERIC_SHAPES).toEqual(['circle', 'square', 'hexagon'])
  })
})

describe('genericFrameUrl', () => {
  it('builds a same-origin data URI, which cannot taint the canvas', () => {
    const url = genericFrameUrl('circle', 'blue')
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
  })

  it('carries explicit dimensions as well as a viewBox', () => {
    // Firefox and Safari cannot draw a dimensionless SVG to a canvas.
    const svg = decode(genericFrameUrl('circle', 'gold'))
    expect(svg).toContain('width="512"')
    expect(svg).toContain('height="512"')
    expect(svg).toContain('viewBox="0 0 512 512"')
  })

  it('draws each shape with its own geometry', () => {
    expect(decode(genericFrameUrl('circle', 'gold'))).toContain('<circle')
    expect(decode(genericFrameUrl('square', 'gold'))).toContain('<rect')
    expect(decode(genericFrameUrl('hexagon', 'gold'))).toContain('<polygon')
  })

  it('resolves a preset colour token to its hex', () => {
    expect(decode(genericFrameUrl('circle', 'blue'))).toContain(ICON_COLOR_PRESETS.blue)
  })

  it('accepts a custom hex literal', () => {
    expect(decode(genericFrameUrl('square', '#ff0088'))).toContain('#ff0088')
  })

  it('falls back to the default colour for an unrecognised value', () => {
    // Never let an unvalidated string reach a style attribute.
    const svg = decode(genericFrameUrl('circle', 'javascript:alert(1)'))
    expect(svg).not.toContain('javascript')
    expect(svg).toContain(ICON_COLOR_PRESETS[DEFAULT_FRAME_COLOR])
  })

  it('leaves the interior unfilled, so the frame is a border not a disc', () => {
    for (const shape of GENERIC_SHAPES) {
      expect(decode(genericFrameUrl(shape, 'gold'))).toContain('fill="none"')
    }
  })

  it('returns null for an unknown shape', () => {
    expect(genericFrameUrl('triangle', 'gold')).toBeNull()
  })

  it('keeps every coordinate inside the viewBox', () => {
    for (const shape of GENERIC_SHAPES) {
      // Strip the colour first: a hex literal is a run of digits too, and
      // matching it would compare colour channels against a coordinate bound.
      const svg = decode(genericFrameUrl(shape, 'gold')).replace(/#[0-9a-f]{3,8}/gi, '')
      const coords = [...svg.matchAll(/(?:points|[cxy]{1,2}|r|width|height)="([^"]+)"/g)]
        .flatMap((m) => m[1].split(/[\s,]+/))
        .map(Number)
        .filter((n) => Number.isFinite(n))

      expect(coords.length).toBeGreaterThan(0)
      for (const n of coords) {
        // 512 is the viewBox edge; nothing may be drawn beyond it.
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThanOrEqual(512)
      }
    }
  })
})

describe('id helpers', () => {
  it('recognises its own ids and extracts the shape', () => {
    expect(isGenericFrame('generic:circle')).toBe(true)
    expect(genericShape('generic:hexagon')).toBe('hexagon')
  })

  it('ignores ids belonging to other frame sources', () => {
    expect(isGenericFrame('builtin:pc')).toBe(false)
    // Server ids are base64url, which contains no colon.
    expect(isGenericFrame('dG9rZW5z')).toBe(false)
    expect(genericShape('builtin:pc')).toBeNull()
  })
})
