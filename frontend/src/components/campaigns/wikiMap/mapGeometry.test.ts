import { describe, expect, it } from 'vitest'
import {
  IDENTITY,
  MAX_SCALE,
  clamp,
  movedPastThreshold,
  nudge,
  toFraction,
  zoomAt,
} from './mapGeometry'

describe('zoomAt', () => {
  it('keeps the point under the cursor still', () => {
    const view = zoomAt(IDENTITY, 2, 100, 50)
    expect(view.scale).toBe(2)
    // The local point (100, 50) lands back on (100, 50) on screen.
    expect(view.x + 100 * view.scale).toBe(100)
    expect(view.y + 50 * view.scale).toBe(50)
  })

  it('stops at the maximum', () => {
    expect(zoomAt({ scale: 6, x: 0, y: 0 }, 4, 0, 0).scale).toBe(MAX_SCALE)
  })

  it('snaps home when zoomed all the way out', () => {
    expect(zoomAt({ scale: 1.5, x: -40, y: -20 }, 0.5, 10, 10)).toEqual(IDENTITY)
  })
})

describe('toFraction', () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 }

  it('measures from the box', () => {
    expect(toFraction(110, 45, rect)).toEqual({ x: 0.5, y: 0.25 })
  })

  it('clamps onto the box', () => {
    expect(toFraction(-50, 500, rect)).toEqual({ x: 0, y: 1 })
  })

  it('falls back to the middle for an unmeasured box', () => {
    expect(toFraction(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('nudge', () => {
  it('moves by 1%, or 5% with Shift', () => {
    expect(nudge('ArrowRight', false, { x: 0.5, y: 0.5 })).toEqual({ x: 0.51, y: 0.5 })
    expect(nudge('ArrowUp', true, { x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.45 })
  })

  it('stays on the map', () => {
    expect(nudge('ArrowLeft', true, { x: 0.02, y: 0.5 })).toEqual({ x: 0, y: 0.5 })
  })

  it('ignores other keys', () => {
    expect(nudge('Enter', false, { x: 0.5, y: 0.5 })).toBeNull()
  })
})

describe('helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1)
  })

  it('tells a drag from a click', () => {
    expect(movedPastThreshold(1, 2)).toBe(false)
    expect(movedPastThreshold(3, 4)).toBe(true)
  })
})
