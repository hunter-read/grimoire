import { describe, it, expect } from 'vitest'
import { distance, distanceToPolyline } from './geometry'
import { HIT_PIXELS, LIGHT_MARKER_PX, LIGHT_PIXELS, gridTolerance, hitTest } from './hitTest'

const cellPx = 140
const view = (scale = 1) => ({ cellPx, scale })

const doc = (over = {}) => ({
  line_of_sight: [],
  objects_line_of_sight: [],
  portals: [],
  lights: [],
  ...over,
})

const wall = (y) => [
  { x: 0, y },
  { x: 10, y },
]

describe('gridTolerance', () => {
  it('converts screen pixels into grid units', () => {
    // One cell is 140 image px, so 10 screen px at 100% is 10/140 of a cell.
    expect(gridTolerance(10, 140, 1)).toBeCloseTo(10 / 140)
  })

  it('shrinks as the view zooms in', () => {
    // This is the whole point: zooming in must actually buy precision.
    expect(gridTolerance(10, 140, 4)).toBeCloseTo(gridTolerance(10, 140, 1) / 4)
  })

  it('widens as the view zooms out, keeping clicks forgiving', () => {
    expect(gridTolerance(10, 140, 0.5)).toBeGreaterThan(gridTolerance(10, 140, 1))
  })

  it('defaults to unzoomed when no scale is given', () => {
    expect(gridTolerance(10, 140)).toBeCloseTo(gridTolerance(10, 140, 1))
  })

  it('refuses to divide by a zero cell size', () => {
    // Would otherwise be Infinity, which selects the whole map from anywhere.
    expect(gridTolerance(10, 0, 1)).toBe(0)
    expect(gridTolerance(10, 140, 0)).toBeGreaterThan(0)
  })
})

describe('hitTest', () => {
  it('finds a wall under the cursor', () => {
    const d = doc({ line_of_sight: [wall(0)] })
    expect(hitTest(d, { x: 5, y: 0 }, view())).toEqual({ key: 'line_of_sight', index: 0 })
  })

  it('selects nothing in empty space', () => {
    const d = doc({ line_of_sight: [wall(0)] })
    expect(hitTest(d, { x: 5, y: 5 }, view())).toBeNull()
  })

  it('finds a light by its marker', () => {
    const d = doc({ lights: [{ position: { x: 2, y: 2 }, range: 4 }] })
    expect(hitTest(d, { x: 2, y: 2 }, view())).toEqual({ key: 'lights', index: 0 })
  })

  it('finds a portal', () => {
    const d = doc({ portals: [{ bounds: wall(3) }] })
    expect(hitTest(d, { x: 5, y: 3 }, view())).toEqual({ key: 'portals', index: 0 })
  })

  it('finds an object wall in its own layer', () => {
    const d = doc({ objects_line_of_sight: [wall(1)] })
    expect(hitTest(d, { x: 5, y: 1 }, view())).toEqual({
      key: 'objects_line_of_sight',
      index: 0,
    })
  })

  describe('a light sitting on a wall', () => {
    // The reported bug: clicking the light's own circle deleted the wall
    // behind it, because a nearer wall beat the light on raw distance.
    const d = doc({
      line_of_sight: [wall(2)],
      lights: [{ position: { x: 5, y: 2 }, range: 4 }],
    })

    it('picks the light when the click is on its centre', () => {
      expect(hitTest(d, { x: 5, y: 2 }, view())).toEqual({ key: 'lights', index: 0 })
    })

    it('picks the light even when the wall is genuinely closer', () => {
      // The real shape of the bug. Light centre (5,2), wall along y=2.05,
      // click at (5,2.04): the wall is 0.01 away and the light's centre 0.04 —
      // the wall is four times nearer and must still lose, because the click
      // landed inside the light's drawn dot.
      const offset = doc({
        line_of_sight: [
          [
            { x: 0, y: 2.05 },
            { x: 10, y: 2.05 },
          ],
        ],
        lights: [{ position: { x: 5, y: 2 }, range: 4 }],
      })
      const pt = { x: 5, y: 2.04 }
      expect(distanceToPolyline(pt, offset.line_of_sight[0])).toBeCloseTo(0.01)
      expect(distance(pt, offset.lights[0].position)).toBeCloseTo(0.04)
      expect(hitTest(offset, pt, view())).toEqual({ key: 'lights', index: 0 })
    })

    it('picks the wall once the click leaves the light marker', () => {
      // Containment is the rule, so outside the dot the wall takes over — a
      // light must not shadow a whole region of the map. Measured along the
      // wall, away from the light, so the point stays within the wall's own
      // (narrower) tolerance while leaving the light's dot behind.
      const outside = gridTolerance(LIGHT_PIXELS, cellPx, 1) + 0.005
      expect(hitTest(d, { x: 5 + outside, y: 2 }, view())).toEqual({
        key: 'line_of_sight',
        index: 0,
      })
    })

    it('still picks the wall well away from the light', () => {
      expect(hitTest(d, { x: 9, y: 2 }, view())).toEqual({ key: 'line_of_sight', index: 0 })
    })
  })

  describe('zooming to separate crowded features', () => {
    // Two walls a tenth of a cell apart — indistinguishable at 100%, where the
    // tolerance covers both, and separable once zoomed in.
    const d = doc({ line_of_sight: [wall(0), wall(0.1)] })

    it('can pick the nearer of two close walls', () => {
      expect(hitTest(d, { x: 5, y: 0.01 }, view(1))).toEqual({ key: 'line_of_sight', index: 0 })
      expect(hitTest(d, { x: 5, y: 0.09 }, view(1))).toEqual({ key: 'line_of_sight', index: 1 })
    })

    it('lets a zoomed-in click reach one without catching the other', () => {
      // At 8x the tolerance is under a hundredth of a cell, so a click on the
      // first wall cannot reach the second at all.
      const near = hitTest(d, { x: 5, y: 0 }, view(8))
      expect(near).toEqual({ key: 'line_of_sight', index: 0 })
      // Halfway between them, zoomed in, nothing is close enough to claim.
      expect(hitTest(d, { x: 5, y: 0.05 }, view(8))).toBeNull()
    })

    it('still catches a near-miss when zoomed out', () => {
      // Zoomed out the same gap is within tolerance, which is what keeps a
      // wall clickable without pixel accuracy at a distance.
      expect(hitTest(d, { x: 5, y: -0.2 }, view(0.25))).toEqual({
        key: 'line_of_sight',
        index: 0,
      })
      expect(hitTest(d, { x: 5, y: -0.2 }, view(4))).toBeNull()
    })
  })

  it('prefers the nearest of several lights', () => {
    const d = doc({
      lights: [
        { position: { x: 0, y: 0 }, range: 1 },
        { position: { x: 0.05, y: 0 }, range: 1 },
      ],
    })
    expect(hitTest(d, { x: 0.05, y: 0 }, view(4))).toEqual({ key: 'lights', index: 1 })
  })

  describe('a crowded cluster', () => {
    // The reported case: several features packed close together. Each one must
    // be reachable by clicking nearest to it — which only works because the
    // select tool no longer snaps the click to a grid intersection first.
    const cluster = doc({
      line_of_sight: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        [
          { x: 0, y: 0.12 },
          { x: 10, y: 0.12 },
        ],
      ],
      portals: [
        {
          bounds: [
            { x: 0, y: 0.24 },
            { x: 10, y: 0.24 },
          ],
        },
      ],
      lights: [{ position: { x: 5, y: 0.36 }, range: 4 }],
    })

    it('reaches every member when zoomed in', () => {
      const v = view(6)
      expect(hitTest(cluster, { x: 5, y: 0 }, v)).toEqual({ key: 'line_of_sight', index: 0 })
      expect(hitTest(cluster, { x: 5, y: 0.12 }, v)).toEqual({ key: 'line_of_sight', index: 1 })
      expect(hitTest(cluster, { x: 5, y: 0.24 }, v)).toEqual({ key: 'portals', index: 0 })
      expect(hitTest(cluster, { x: 5, y: 0.36 }, v)).toEqual({ key: 'lights', index: 0 })
    })

    it('leaves gaps between them once zoomed in far enough', () => {
      // Precision you can actually use: between two features, nothing is
      // claimed, rather than one of them grabbing the whole band.
      expect(hitTest(cluster, { x: 5, y: 0.06 }, view(8))).toBeNull()
    })
  })

  it('survives a document with missing arrays', () => {
    expect(hitTest({}, { x: 0, y: 0 }, view())).toBeNull()
    expect(hitTest(null, { x: 0, y: 0 }, view())).toBeNull()
  })

  it('skips malformed features rather than throwing', () => {
    const d = doc({ lights: [null, {}], portals: [{}] })
    expect(hitTest(d, { x: 0, y: 0 }, view())).toBeNull()
  })

  it('selects nothing when the cell size is unknown', () => {
    const d = doc({ line_of_sight: [wall(0)] })
    expect(hitTest(d, { x: 5, y: 0 }, { cellPx: 0, scale: 1 })).toBeNull()
  })

  it('gives a light a larger reach than a wall, matching its drawn dot', () => {
    expect(LIGHT_PIXELS).toBeGreaterThan(HIT_PIXELS)
  })

  it('accepts clicks out to at least the radius the marker is drawn at', () => {
    // The canvas draws the dot at LIGHT_MARKER_PX; if the hit radius were ever
    // smaller, part of the visible circle would not be clickable.
    expect(LIGHT_PIXELS).toBeGreaterThanOrEqual(LIGHT_MARKER_PX)
  })

  it('selects a light clicked at the edge of its drawn dot', () => {
    const d = doc({ lights: [{ position: { x: 3, y: 3 }, range: 4 }] })
    const edge = gridTolerance(LIGHT_MARKER_PX, cellPx, 1)
    expect(hitTest(d, { x: 3 + edge, y: 3 }, view())).toEqual({ key: 'lights', index: 0 })
  })
})
