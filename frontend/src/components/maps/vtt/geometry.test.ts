import { describe, it, expect } from 'vitest'
import {
  calibrateFromPoints,
  distanceToPolyline,
  distanceToSegment,
  gridDimensions,
  gridToImage,
  imageToGrid,
  isClosed,
  round4,
  snapToGrid,
  snapToHalf,
} from './geometry'

describe('imageToGrid / gridToImage', () => {
  it('converts pixels to grid squares', () => {
    expect(imageToGrid({ x: 280, y: 420 }, 140)).toEqual({ x: 2, y: 3 })
  })

  it('subtracts the calibrated origin offset', () => {
    // A map with a margin: the grid does not start at the image corner.
    expect(imageToGrid({ x: 300, y: 160 }, 140, { x: 20, y: 20 })).toEqual({ x: 2, y: 1 })
  })

  it('round-trips exactly', () => {
    const offset = { x: 17, y: 4 }
    const grid = imageToGrid({ x: 913, y: 622 }, 138.5, offset)
    const back = gridToImage(grid, 138.5, offset)
    expect(back.x).toBeCloseTo(913, 6)
    expect(back.y).toBeCloseTo(622, 6)
  })
})

describe('snapping', () => {
  it('snaps to the nearest intersection', () => {
    // Intersections, not cell centres: a wall runs along a cell edge.
    expect(snapToGrid({ x: 3.4, y: 6.6 })).toEqual({ x: 3, y: 7 })
  })

  it('snaps to half cells for walls that split a square', () => {
    expect(snapToHalf({ x: 3.3, y: 6.6 })).toEqual({ x: 3.5, y: 6.5 })
  })
})

describe('round4', () => {
  it('trims to the stored precision', () => {
    expect(round4(1.234567)).toBe(1.2346)
  })
})

describe('distanceToSegment', () => {
  it('measures perpendicular distance to the segment', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
  })

  it('clamps past the ends rather than using the infinite line', () => {
    // Without clamping this would report 0 — a click far off the end of a wall
    // would select it.
    expect(distanceToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10)
  })

  it('handles a degenerate zero-length segment', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })
})

describe('distanceToPolyline', () => {
  it('returns the closest of all segments', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]
    expect(distanceToPolyline({ x: 11, y: 5 }, line)).toBe(1)
  })

  it('is Infinity for an empty polyline', () => {
    expect(distanceToPolyline({ x: 0, y: 0 }, [])).toBe(Infinity)
  })

  it('falls back to point distance for a single vertex', () => {
    expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBe(5)
  })
})

describe('calibrateFromPoints', () => {
  it('derives the cell size from the span between picks', () => {
    // Ten cells apart divides the user's aiming error by ten — the whole point
    // of asking for a span rather than assuming adjacent picks.
    const result = calibrateFromPoints(
      [
        { x: 100, y: 100 },
        { x: 1500, y: 100 },
      ],
      10,
      0
    )
    expect(result.cellPx).toBe(140)
  })

  it('averages both axes when the picks span both', () => {
    const result = calibrateFromPoints(
      [
        { x: 0, y: 0 },
        { x: 280, y: 420 },
      ],
      2,
      3
    )
    expect(result.cellPx).toBe(140)
  })

  it('derives an origin offset inside the first cell', () => {
    const result = calibrateFromPoints(
      [
        { x: 170, y: 30 },
        { x: 590, y: 30 },
      ],
      3,
      0
    )
    expect(result.cellPx).toBe(140)
    expect(result.offset.x).toBe(30)
  })

  it('returns null without at least two points', () => {
    expect(calibrateFromPoints([{ x: 1, y: 1 }], 2, 2)).toBeNull()
    expect(calibrateFromPoints(null, 2, 2)).toBeNull()
  })

  it('returns null when no span was given', () => {
    expect(
      calibrateFromPoints(
        [
          { x: 0, y: 0 },
          { x: 140, y: 0 },
        ],
        0,
        0
      )
    ).toBeNull()
  })
})

describe('gridDimensions', () => {
  it('reports fractional cells for a map that bleeds past its grid', () => {
    // Real battlemaps carry partial cells; the format's map_size is numeric
    // for exactly this reason.
    expect(gridDimensions(4690, 3430, 140)).toEqual({ width: 33.5, height: 24.5 })
  })

  it('accounts for the origin offset', () => {
    expect(gridDimensions(1420, 1420, 140, { x: 20, y: 20 })).toEqual({ width: 10, height: 10 })
  })

  it('is zero without a cell size', () => {
    expect(gridDimensions(1000, 1000, 0)).toEqual({ width: 0, height: 0 })
  })
})

describe('isClosed', () => {
  it('detects a room whose last point repeats the first', () => {
    expect(
      isClosed([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 0 },
      ])
    ).toBe(true)
  })

  it('is false for an open run', () => {
    expect(
      isClosed([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ])
    ).toBe(false)
  })

  it('is false for anything shorter than three points', () => {
    expect(
      isClosed([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ])
    ).toBe(false)
  })
})
