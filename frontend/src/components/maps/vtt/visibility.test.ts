import { describe, it, expect } from 'vitest'
import {
  collectSegments,
  computeVisibility,
  polygonPath,
  rayHit,
  hasLineOfSight,
  litRegions,
  reachingLights,
} from './visibility'

/** Is `pt` inside the polygon? Ray-casting, used to assert what is visible. */
const contains = (poly, pt) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

describe('collectSegments', () => {
  it('collects wall runs as individual segments', () => {
    const doc = {
      line_of_sight: [
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
        ],
      ],
    }
    // A three-point run is two segments, not one.
    expect(collectSegments(doc)).toHaveLength(2)
  })

  it('treats object walls as blockers too', () => {
    const doc = {
      objects_line_of_sight: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      ],
    }
    expect(collectSegments(doc)).toHaveLength(1)
  })

  it('blocks sight with a closed door', () => {
    const doc = {
      portals: [
        {
          closed: true,
          bounds: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ],
    }
    // A shut door is what makes the room beyond dark.
    expect(collectSegments(doc)).toHaveLength(1)
  })

  it('lets sight through a window', () => {
    const doc = {
      portals: [
        {
          closed: false,
          bounds: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ],
    }
    // A window is see-through by definition; blocking here would be wrong.
    expect(collectSegments(doc)).toHaveLength(0)
  })

  it('survives an empty or partial document', () => {
    expect(collectSegments(null)).toEqual([])
    expect(collectSegments({})).toEqual([])
    expect(collectSegments({ portals: [{ closed: true }] })).toEqual([])
  })
})

describe('rayHit', () => {
  const seg = {
    a: { x: 2, y: -1 },
    b: { x: 2, y: 1 },
  }

  it('reports the distance to a segment straight ahead', () => {
    expect(rayHit({ x: 0, y: 0 }, 1, 0, seg)).toBeCloseTo(2)
  })

  it('misses a segment behind the origin', () => {
    expect(rayHit({ x: 0, y: 0 }, -1, 0, seg)).toBeNull()
  })

  it('misses when the ray passes beyond the segment ends', () => {
    // Aimed well above the segment's extent.
    expect(rayHit({ x: 0, y: 5 }, 1, 0, seg)).toBeNull()
  })

  it('reports nothing for a parallel ray', () => {
    expect(rayHit({ x: 0, y: 0 }, 0, 1, { a: { x: 1, y: 0 }, b: { x: 1, y: 5 } })).toBeNull()
  })
})

describe('computeVisibility', () => {
  it('sees all around when nothing blocks', () => {
    const poly = computeVisibility({ x: 0, y: 0 }, [], 5)
    expect(poly.length).toBeGreaterThan(8)
    // Every direction reaches the full range.
    for (const p of poly) expect(Math.hypot(p.x, p.y)).toBeCloseTo(5, 4)
  })

  it('stops at a wall and hides what is behind it', () => {
    // A wall at x=2 spanning the whole view.
    const segments = [{ a: { x: 2, y: -10 }, b: { x: 2, y: 10 } }]
    const poly = computeVisibility({ x: 0, y: 0 }, segments, 0)
    expect(contains(poly, { x: 1, y: 0 })).toBe(true)
    // The point beyond the wall is the whole reason the preview exists.
    expect(contains(poly, { x: 5, y: 0 })).toBe(false)
  })

  it('sees around a corner rather than stopping at it', () => {
    // A stub wall that does not span the view: what lies past its end is
    // reachable, which is what the nudged corner rays are for.
    const segments = [{ a: { x: 2, y: 0 }, b: { x: 2, y: 4 } }]
    const poly = computeVisibility({ x: 0, y: 0 }, segments, 0)
    expect(contains(poly, { x: 5, y: -2 })).toBe(true)
    expect(contains(poly, { x: 5, y: 2 })).toBe(false)
  })

  it('honours a sight limit', () => {
    const poly = computeVisibility({ x: 0, y: 0 }, [], 3)
    for (const p of poly) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(3.0001)
  })

  it('treats a zero range as unlimited rather than blind', () => {
    const poly = computeVisibility({ x: 0, y: 0 }, [], 0)
    // A zero here means "no limit", so it must not collapse to a point.
    expect(Math.hypot(poly[0].x, poly[0].y)).toBeGreaterThan(100)
  })

  it('returns points in angular order so they form a polygon', () => {
    const segments = [{ a: { x: 2, y: 0 }, b: { x: 2, y: 4 } }]
    const poly = computeVisibility({ x: 0, y: 0 }, segments, 10)
    const angles = poly.map((p) => Math.atan2(p.y, p.x))
    const sorted = [...angles].sort((a, b) => a - b)
    expect(angles).toEqual(sorted)
  })

  it('is enclosed by a room', () => {
    const room = [
      { a: { x: -3, y: -3 }, b: { x: 3, y: -3 } },
      { a: { x: 3, y: -3 }, b: { x: 3, y: 3 } },
      { a: { x: 3, y: 3 }, b: { x: -3, y: 3 } },
      { a: { x: -3, y: 3 }, b: { x: -3, y: -3 } },
    ]
    const poly = computeVisibility({ x: 0, y: 0 }, room, 0)
    // Nothing outside the room is visible from inside it.
    for (const p of poly) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(3.001)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(3.001)
    }
  })
})

describe('computeVisibility range culling', () => {
  // Culling walls outside the reach is what makes per-light polygons
  // affordable, but a wrong cull silently lets light through a wall — the
  // worst possible failure for this feature. These pin the boundary.
  it('is still blocked by a long wall whose endpoints are both far away', () => {
    // Both ends are 50 squares off, but the wall passes one square from the
    // origin. Culling on endpoint distance would wrongly drop it.
    const wall = [{ a: { x: -50, y: 1 }, b: { x: 50, y: 1 } }]
    const poly = computeVisibility({ x: 0, y: 0 }, wall, 5)
    // Nothing below the wall is reachable from above it.
    for (const p of poly) expect(p.y).toBeLessThanOrEqual(1.001)
  })

  it('ignores a wall genuinely beyond the reach', () => {
    const near = computeVisibility({ x: 0, y: 0 }, [], 5)
    const far = computeVisibility({ x: 0, y: 0 }, [{ a: { x: 20, y: -5 }, b: { x: 20, y: 5 } }], 5)
    // A wall 20 squares away cannot change a 5-square polygon.
    expect(far).toEqual(near)
  })

  it('matches the unculled result for a wall right at the edge of reach', () => {
    const wall = [{ a: { x: 5, y: -5 }, b: { x: 5, y: 5 } }]
    const bounded = computeVisibility({ x: 0, y: 0 }, wall, 6)
    // The wall is inside 6, so it must still clip the polygon at x=5.
    expect(Math.max(...bounded.map((p) => p.x))).toBeLessThanOrEqual(5.001)
  })
})

describe('reachingLights', () => {
  const light = (x, y, range = 5) => ({ position: { x, y }, range })

  it('keeps a light in reach with a clear path', () => {
    expect(reachingLights({ x: 0, y: 0 }, [light(2, 0)], [])).toHaveLength(1)
  })

  it('drops a light that is out of range', () => {
    expect(reachingLights({ x: 0, y: 0 }, [light(20, 0)], [])).toHaveLength(0)
  })

  it('drops a light behind a wall', () => {
    const wall = [{ a: { x: 1, y: -5 }, b: { x: 1, y: 5 } }]
    // A lamp in the next room must not brighten this one.
    expect(reachingLights({ x: 0, y: 0 }, [light(2, 0)], wall)).toHaveLength(0)
  })

  it('keeps a light whose wall lies beyond it', () => {
    const wall = [{ a: { x: 5, y: -5 }, b: { x: 5, y: 5 } }]
    expect(reachingLights({ x: 0, y: 0 }, [light(2, 0)], wall)).toHaveLength(1)
  })

  it('counts a light the token is standing on', () => {
    expect(reachingLights({ x: 1, y: 1 }, [light(1, 1)], [])).toHaveLength(1)
  })

  it('treats a zero range as unlimited', () => {
    expect(reachingLights({ x: 0, y: 0 }, [light(50, 0, 0)], [])).toHaveLength(1)
  })

  it('survives no lights at all', () => {
    expect(reachingLights({ x: 0, y: 0 }, null, [])).toEqual([])
  })
})

describe('reachingLights range ownership', () => {
  // The bug this whole change exists to fix: a torch on a table lights the
  // room it stands in, so a token across that room is lit by it. The radius
  // that matters is the light's, and nothing about the token limits it.
  it('lights a token standing well away from the lamp, inside its radius', () => {
    const lamp = { position: { x: 0, y: 0 }, range: 8 }
    // Six squares off — nowhere near standing on it, comfortably inside its 8.
    expect(reachingLights({ x: 6, y: 0 }, [lamp], [])).toHaveLength(1)
  })

  it('stops at the edge of the light, not at the token', () => {
    const lamp = { position: { x: 0, y: 0 }, range: 4 }
    expect(reachingLights({ x: 3.9, y: 0 }, [lamp], [])).toHaveLength(1)
    expect(reachingLights({ x: 4.1, y: 0 }, [lamp], [])).toHaveLength(0)
  })

  it('ignores a malformed light rather than throwing', () => {
    expect(reachingLights({ x: 0, y: 0 }, [{ range: 5 }, null], [])).toEqual([])
  })
})

describe('hasLineOfSight', () => {
  it('is clear with nothing in the way', () => {
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 5, y: 0 }, [])).toBe(true)
  })

  it('is blocked by a wall between the two points', () => {
    const wall = [{ a: { x: 2, y: -5 }, b: { x: 2, y: 5 } }]
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 5, y: 0 }, wall)).toBe(false)
  })

  it('is clear when the wall lies beyond the target', () => {
    const wall = [{ a: { x: 9, y: -5 }, b: { x: 9, y: 5 } }]
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 5, y: 0 }, wall)).toBe(true)
  })

  it('treats coincident points as clear', () => {
    const wall = [{ a: { x: -5, y: 0 }, b: { x: 5, y: 0 } }]
    expect(hasLineOfSight({ x: 1, y: 1 }, { x: 1, y: 1 }, wall)).toBe(true)
  })
})

describe('litRegions', () => {
  const token = { x: 0, y: 0 }

  it('reveals nothing when the token has no vision', () => {
    const lights = [{ position: { x: 1, y: 0 }, range: 5 }]
    expect(litRegions({ token, lights, segments: [], tokenLight: 4, hasVision: false })).toEqual([])
  })

  it('reveals nothing without a token', () => {
    expect(litRegions({ token: null, lights: [], segments: [] })).toEqual([])
  })

  it('contributes a region for the carried light', () => {
    const regions = litRegions({ token, lights: [], segments: [], tokenLight: 4 })
    expect(regions.map((r) => r.kind)).toEqual(['token-light'])
  })

  it('contributes a night-vision region only when night vision is on', () => {
    expect(
      litRegions({ token, lights: [], segments: [], nightVision: 6 }).map((r) => r.kind)
    ).toEqual(['night'])
    expect(litRegions({ token, lights: [], segments: [], nightVision: 0 })).toEqual([])
  })

  it('builds a placed light region around the light, not around the token', () => {
    // The light sits far from the token; its region must be centred on it, so
    // the ground it lights is revealed rather than a disc at the token.
    const lights = [{ position: { x: 10, y: 0 }, range: 3 }]
    const regions = litRegions({ token, lights, segments: [] })
    expect(regions).toHaveLength(1)
    const xs = regions[0].polygon.map((p) => p.x)
    // Every point of the light's polygon is out near the light.
    expect(Math.min(...xs)).toBeGreaterThan(6)
  })

  it('keeps a light whose source is hidden but whose spill is not', () => {
    // A brazier behind a corner still lights floor the token can see. The
    // region is emitted regardless of sight to the source; the renderer
    // intersects it with the token's sight polygon.
    const wall = [{ a: { x: 5, y: -5 }, b: { x: 5, y: 0.5 } }]
    const lights = [{ position: { x: 8, y: 0 }, range: 6 }]
    expect(litRegions({ token, lights, segments: wall })).toHaveLength(1)
  })

  it('skips a malformed light', () => {
    expect(litRegions({ token, lights: [null, {}], segments: [] })).toEqual([])
  })

  it('composes every source at once', () => {
    const lights = [{ position: { x: 4, y: 0 }, range: 3 }]
    const regions = litRegions({
      token,
      lights,
      segments: [],
      nightVision: 5,
      tokenLight: 2,
    })
    expect(regions.map((r) => r.kind)).toEqual(['night', 'token-light', 'light'])
  })
})

describe('polygonPath', () => {
  it('builds a closed path', () => {
    const d = polygonPath([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ])
    expect(d).toBe('M0 0 L1 0 L1 1 Z')
  })

  it('is empty for no points', () => {
    expect(polygonPath([])).toBe('')
    expect(polygonPath(null)).toBe('')
  })
})
