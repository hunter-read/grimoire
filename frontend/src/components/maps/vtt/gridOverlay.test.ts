import { describe, it, expect } from 'vitest'
import { gridOverlayStyle } from './gridOverlay'

describe('gridOverlayStyle', () => {
  it('makes background-size the cell pitch', () => {
    // The whole point: a 300px cell must tile every 300px. With a *repeating*
    // gradient this was ignored, and a 21x18 grid drew neither 21 nor 18 lines.
    const s = gridOverlayStyle(300, { x: 0, y: 0 })
    expect(s.backgroundSize).toBe('300px 300px, 300px 300px')
  })

  it('uses plain gradients, whose period cannot fight background-size', () => {
    const s = gridOverlayStyle(300, { x: 0, y: 0 })
    expect(s.backgroundImage).not.toMatch(/repeating-linear-gradient/)
    expect(s.backgroundImage).toMatch(/^linear-gradient/)
  })

  it('does not close the line stop at 100%', () => {
    // `transparent 1px 100%` is what set the rogue repeat period.
    const s = gridOverlayStyle(300, { x: 0, y: 0 })
    expect(s.backgroundImage).not.toContain('100%')
  })

  it('keeps the line one screen pixel wide when zoomed out', () => {
    // At 22% zoom a 1px line is 0.22 screen px — the browser drops or dithers
    // it, which is why whole rows of lines went missing on a big battlemap.
    const s = gridOverlayStyle(300, { x: 0, y: 0 }, 0.22)
    const width = Number(s.backgroundImage.match(/0 ([\d.]+)px/)[1])
    expect(width * 0.22).toBeCloseTo(1, 5)
  })

  it('keeps the line thin when zoomed in', () => {
    const s = gridOverlayStyle(300, { x: 0, y: 0 }, 8)
    const width = Number(s.backgroundImage.match(/0 ([\d.]+)px/)[1])
    // Clamped so a hairline never vanishes, but still sub-pixel on the image.
    expect(width).toBeLessThanOrEqual(0.5)
  })

  it('never produces a zero-width line', () => {
    const s = gridOverlayStyle(300, { x: 0, y: 0 }, 100000)
    const width = Number(s.backgroundImage.match(/0 ([\d.]+)px/)[1])
    expect(width).toBeGreaterThan(0)
  })

  it('positions the grid by the calibrated offset', () => {
    const s = gridOverlayStyle(140, { x: 17, y: 4 })
    expect(s.backgroundPosition).toBe('17px 4px')
  })

  it('takes an opacity, so the drawing canvas can sit dimmer than calibration', () => {
    expect(gridOverlayStyle(140, { x: 0, y: 0 }, 1, 0.35).opacity).toBe(0.35)
    expect(gridOverlayStyle(140, { x: 0, y: 0 }).opacity).toBe(0.55)
  })

  it('draws nothing without a cell size', () => {
    expect(gridOverlayStyle(0, { x: 0, y: 0 })).toBeNull()
    expect(gridOverlayStyle(-5, { x: 0, y: 0 })).toBeNull()
  })

  it('tiles once per cell across the image', () => {
    // A 21-cell map at 300px must tile 21 times over its 6300px width, giving
    // 21 cells plus the closing edge.
    const cell = 300
    const s = gridOverlayStyle(cell, { x: 0, y: 0 })
    const tile = Number(s.backgroundSize.match(/^([\d.]+)px/)[1])
    expect(6300 / tile).toBe(21)
  })
})
