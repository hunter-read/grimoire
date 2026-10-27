import { describe, it, expect } from 'vitest'
import {
  boxFromDrag,
  clampBox,
  fromStage,
  isTiny,
  layoutFor,
  moveBox,
  overlap,
  pixelSize,
  resizeBox,
  squareUp,
  toStage,
} from './cutoutGeometry'

const sizes = {
  1: { width: 200, height: 300 },
  2: { width: 200, height: 300 },
  3: { width: 100, height: 150 },
}
const close = (a, b) => Object.keys(b).forEach((k) => expect(a[k]).toBeCloseTo(b[k], 6))

describe('layoutFor', () => {
  it('lays pages side by side at the first page height', () => {
    const l = layoutFor([1, 2], sizes)
    expect(l.width).toBe(400)
    expect(l.height).toBe(300)
    expect(l.parts).toEqual([
      { page: 1, offset: 0, width: 200 },
      { page: 2, offset: 200, width: 200 },
    ])
  })

  it('scales a smaller facing page up to match', () => {
    const l = layoutFor([2, 3], sizes)
    expect(l.parts[1].width).toBe(200)
  })

  it('is null until every size is known', () => {
    expect(layoutFor([1, 9], sizes)).toBeNull()
    expect(layoutFor([], sizes)).toBeNull()
  })
})

describe('stage mapping', () => {
  const spread = layoutFor([1, 2], sizes)
  const single = layoutFor([1], sizes)

  it('maps a single-page cut-out onto the right half of a spread', () => {
    const box = toStage({ pages: [2], x: 0.5, y: 0.1, w: 0.5, h: 0.2 }, spread)
    close(box, { x: 0.75, y: 0.1, w: 0.25, h: 0.2 })
  })

  it('passes a cut-out drawn on the same pages through unchanged', () => {
    expect(toStage({ pages: [1, 2], x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, spread)).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
    })
  })

  it('hides cut-outs from other pages', () => {
    expect(toStage({ pages: [3], x: 0, y: 0, w: 1, h: 1 }, spread)).toBeNull()
    expect(toStage({ pages: [1, 2], x: 0, y: 0, w: 1, h: 1 }, single)).toBeNull()
    expect(toStage({ pages: [1], x: 0, y: 0, w: 1, h: 1 }, null)).toBeNull()
  })

  it('stores a box inside one page of a spread against that page', () => {
    const c = fromStage({ x: 0.6, y: 0.1, w: 0.2, h: 0.3 }, spread)
    expect(c.pages).toEqual([2])
    close(c, { x: 0.2, y: 0.1, w: 0.4, h: 0.3 })
  })

  it('keeps a box across the gutter on both pages', () => {
    const c = fromStage({ x: 0.4, y: 0, w: 0.2, h: 0.5 }, spread)
    expect(c.pages).toEqual([1, 2])
    close(c, { x: 0.4, w: 0.2 })
  })

  it('round-trips through the stage', () => {
    const original = { pages: [1], x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
    const back = fromStage(toStage(original, spread), spread)
    expect(back.pages).toEqual([1])
    close(back, original)
  })

  it('maps a single-page stage directly', () => {
    expect(fromStage({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, single)).toEqual({
      pages: [1],
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.2,
    })
  })
})

describe('box editing', () => {
  it('clamps into the stage', () => {
    expect(clampBox({ x: 0.9, y: -0.2, w: 0.3, h: 0.3 })).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.3 })
    expect(clampBox({ x: 0, y: 0, w: 2, h: 2 })).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('draws a box from a drag in any direction', () => {
    close(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 }), { x: 0.2, y: 0.3, w: 0.3, h: 0.2 })
  })

  it('draws a square on the page, not on the stage', () => {
    // A 2:1 stage: equal page lengths mean w is half of h.
    const b = boxFromDrag({ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }, { square: true, aspect: 2 })
    expect(b.w * 2).toBeCloseTo(b.h, 6)
    expect(b.x).toBeCloseTo(0.1, 6)
    expect(b.y).toBeCloseTo(0.1, 6)
  })

  it('grows a square toward the pointer when dragged up and left', () => {
    const b = boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.4 }, { square: true, aspect: 1 })
    expect(b.x + b.w).toBeCloseTo(0.5, 6)
    expect(b.y + b.h).toBeCloseTo(0.5, 6)
    expect(b.w).toBeCloseTo(b.h, 6)
  })

  it('shrinks a square rather than spilling off the stage', () => {
    const b = squareUp({ x: 0, y: 0, w: 1, h: 0.5 }, 0.5)
    expect(b.w).toBeLessThanOrEqual(1)
    expect(b.h).toBeLessThanOrEqual(1)
  })

  it('moves and stops at the edges', () => {
    expect(moveBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 0.1, 0)).toEqual({
      x: 0.2,
      y: 0.1,
      w: 0.2,
      h: 0.2,
    })
    expect(moveBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 5, 5).x).toBeCloseTo(0.8, 6)
  })

  it('resizes from each handle', () => {
    const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }
    close(resizeBox(box, 'se', 0.1, 0.1), { x: 0.2, y: 0.2, w: 0.5, h: 0.5 })
    close(resizeBox(box, 'nw', 0.1, 0.1), { x: 0.3, y: 0.3, w: 0.3, h: 0.3 })
    close(resizeBox(box, 'e', 0.1, 0.3), { x: 0.2, y: 0.2, w: 0.5, h: 0.4 })
    close(resizeBox(box, 'n', 0, -0.1), { x: 0.2, y: 0.1, w: 0.4, h: 0.5 })
  })

  it('never inverts a box', () => {
    const b = resizeBox({ x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, 'se', -1, -1)
    expect(b.w).toBeGreaterThan(0)
    expect(b.h).toBeGreaterThan(0)
  })

  it('keeps a locked box square while resizing from a corner or an edge', () => {
    const corner = resizeBox({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, 'se', 0.2, 0.05, {
      square: true,
      aspect: 1,
    })
    expect(corner.w).toBeCloseTo(corner.h, 6)
    expect(corner.x).toBeCloseTo(0.2, 6)
    const edge = resizeBox({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, 'w', -0.1, 0, {
      square: true,
      aspect: 1,
    })
    expect(edge.w).toBeCloseTo(edge.h, 6)
  })

  it('treats a click as no box', () => {
    expect(isTiny({ w: 0.001, h: 0.5 })).toBe(true)
    expect(isTiny({ w: 0.2, h: 0.2 })).toBe(false)
  })

  it('measures overlap', () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 }
    expect(overlap(a, a)).toBe(1)
    expect(overlap(a, { x: 0.6, y: 0.6, w: 0.1, h: 0.1 })).toBe(0)
    expect(overlap(a, { x: 0.25, y: 0, w: 0.5, h: 0.5 })).toBeCloseTo(1 / 3, 6)
    expect(overlap({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(0)
  })
})

describe('pixelSize', () => {
  it('converts points at the chosen dpi', () => {
    expect(pixelSize({ pages: [1], w: 0.5, h: 0.5 }, sizes, 144)).toEqual({
      width: 200,
      height: 300,
    })
    expect(pixelSize({ pages: [1, 2], w: 1, h: 1 }, sizes, 72)).toEqual({ width: 400, height: 300 })
  })

  it('is null until sizes are known', () => {
    expect(pixelSize({ pages: [7], w: 1, h: 1 }, sizes, 72)).toBeNull()
  })
})
