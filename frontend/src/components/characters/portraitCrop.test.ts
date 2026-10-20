import { describe, it, expect } from 'vitest'
import { CENTRED, framedImageStyle, framingOf } from './portraitCrop'

describe('framingOf', () => {
  it('reads no crop as centred', () => {
    expect(framingOf(null)).toEqual(CENTRED)
    expect(framingOf(undefined)).toEqual(CENTRED)
    expect(framingOf({})).toEqual(CENTRED)
  })

  it('keeps a crop in range and ignores what is not a number', () => {
    expect(framingOf({ x: -5, y: 150, zoom: 9 })).toEqual({ x: 0, y: 100, zoom: 4 })
    expect(framingOf({ x: Number.NaN, zoom: 0.2 })).toEqual({ x: 50, y: 50, zoom: 1 })
  })
})

describe('framedImageStyle', () => {
  it('centres an uncropped picture without scaling it', () => {
    const style = framedImageStyle(null)
    expect(style.objectFit).toBe('cover')
    expect(style.objectPosition).toBe('50% 50%')
    expect(style.transform).toBeUndefined()
  })

  it('keeps the focus point in view and zooms about it', () => {
    const style = framedImageStyle({ x: 40, y: 10, zoom: 2 })
    expect(style.objectPosition).toBe('40% 10%')
    expect(style.transform).toBe('scale(2)')
    expect(style.transformOrigin).toBe('40% 10%')
  })
})
