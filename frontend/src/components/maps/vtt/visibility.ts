/**
 * What a token at a given point can see, given the authored walls.
 *
 * This is the preview's whole substance. A GM's real question about a set of
 * walls is "can my players see around that corner?", and only an actual
 * line-of-sight computation answers it — light circles drawn over the map look
 * lit in exactly the places a real VTT would render dark, which is worse than
 * showing nothing because it invites the wrong conclusion.
 *
 * The algorithm is the standard one VTTs use: shoot a ray at each wall endpoint
 * (and a hair either side of it, so a ray can slip past a corner and reach what
 * lies beyond), plus a baseline ring covering every direction, keep the nearest
 * hit along each ray, then join the hits in angular order into one polygon.
 * Everything outside that polygon is hidden.
 *
 * Cost is O(rays x segments) — 3 rays per endpoint plus the ring. A dense
 * dungeon of ~400 wall runs is a few thousand segment tests per move,
 * comfortably inside a frame, and it only recomputes when the token moves or
 * the walls change.
 *
 * Coordinates throughout are **grid units**, matching the stored document.
 */

import { distanceToSegment } from './geometry'

// How far either side of a corner the extra rays are aimed. Small enough that
// the ray still passes the corner it is meant to clear, large enough to survive
// floating-point noise at the scales a battlemap uses.
const CORNER_NUDGE = 0.00001

// Fallback reach when sight is unlimited: the polygon still needs a finite
// bound, so rays stop at a distance no battlemap exceeds.
const UNBOUNDED = 10000

/**
 * Every wall as a flat list of segments.
 *
 * Windows are deliberately included as *transparent*: a window is a portal you
 * can see through, so it must not block the ray. Closed portals (doors) do
 * block — a shut door is what makes the room beyond dark, which is exactly the
 * thing a GM is checking. Object walls block sight too; importers treat them
 * differently for movement, but they are line-of-sight blockers by name.
 */
export function collectSegments(doc) {
  const segments = []
  const pushLine = (points) => {
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({ a: points[i], b: points[i + 1] })
    }
  }
  for (const line of doc?.line_of_sight || []) pushLine(line)
  for (const line of doc?.objects_line_of_sight || []) pushLine(line)
  for (const portal of doc?.portals || []) {
    // `closed: true` is a door — solid until someone opens it. A window
    // (`closed: false`) is see-through and contributes no barrier.
    if (portal?.closed && portal.bounds?.length === 2) {
      segments.push({ a: portal.bounds[0], b: portal.bounds[1] })
    }
  }
  return segments
}

/**
 * Where a ray from `origin` at `angle` first meets a segment.
 *
 * Returns the distance along the ray, or null when it misses. Solved
 * parametrically rather than by stepping: an exact intersection keeps corners
 * crisp, where marching would round them off at whatever step size was chosen.
 */
export function rayHit(origin, dx, dy, seg) {
  const sx = seg.b.x - seg.a.x
  const sy = seg.b.y - seg.a.y
  const denom = dx * sy - dy * sx
  // Parallel (or degenerate): no single crossing point to report.
  if (Math.abs(denom) < 1e-12) return null
  const px = seg.a.x - origin.x
  const py = seg.a.y - origin.y
  // Distance along the ray.
  const t = (px * sy - py * sx) / denom
  // Position along the segment, which must lie within it to count.
  const u = (px * dy - py * dx) / denom
  if (t <= 0 || u < 0 || u > 1) return null
  return t
}

/**
 * The visible polygon from `origin`, as a list of grid-space points.
 *
 * `maxRange` bounds the reach in grid squares; 0 or less means unlimited, which
 * still terminates at the fallback distance so the polygon closes.
 *
 * An empty wall list yields a circle-ish polygon of the full range rather than
 * nothing: with no walls, everything in reach is visible, and returning an
 * empty polygon would render that as total darkness.
 */
export function computeVisibility(origin, segments, maxRange = 0) {
  const reach = maxRange > 0 ? maxRange : UNBOUNDED

  // Only walls that can possibly be hit within `reach` matter. A bounded
  // polygon — every placed light, and night vision — is usually a small circle
  // on a large map, and testing it against the whole dungeon's walls is nearly
  // all wasted work.
  //
  // This is what makes per-light polygons affordable. Without it a map with a
  // few dozen lights costs the better part of a second per token move, because
  // each light pays for every wall on the map twice over: once generating a
  // pair of corner rays that cannot reach it, and again testing every ray
  // against it.
  //
  // The test is conservative — distance from the origin to the segment, not to
  // its endpoints — so a long wall passing close by is kept even when both of
  // its ends are far away. Culling on endpoints alone would drop exactly the
  // walls most likely to be blocking something.
  const near =
    reach >= UNBOUNDED
      ? segments
      : segments.filter((seg) => distanceToSegment(origin, seg.a, seg.b) <= reach)

  // Aim at every endpoint, plus a hair either side so a ray can round the
  // corner and light what is behind it. Without the nudged pair, the polygon
  // stops dead at each corner and produces visible notches.
  const angles = []
  for (const seg of near) {
    for (const p of [seg.a, seg.b]) {
      const base = Math.atan2(p.y - origin.y, p.x - origin.x)
      angles.push(base - CORNER_NUDGE, base, base + CORNER_NUDGE)
    }
  }

  // A baseline ring of rays, always — not only when there are no walls.
  // Endpoint rays alone describe the walls but say nothing about the
  // directions between them, so a single wall off to one side would leave the
  // whole open half of the view unsampled and the polygon would cut straight
  // across it. The ring guarantees every direction is represented; the
  // endpoint rays then sharpen the corners.
  const RING = 64
  for (let i = 0; i < RING; i++) angles.push((i / RING) * Math.PI * 2 - Math.PI)

  const points = []
  for (const angle of angles) {
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    let nearest = reach
    for (const seg of near) {
      const t = rayHit(origin, dx, dy, seg)
      if (t !== null && t < nearest) nearest = t
    }
    points.push({ angle, x: origin.x + dx * nearest, y: origin.y + dy * nearest })
  }

  // Angular order is what makes these a polygon rather than a scribble.
  points.sort((p, q) => p.angle - q.angle)
  return points.map(({ x, y }) => ({ x, y }))
}

/**
 * Whether the straight line between two points is clear of every wall.
 *
 * Split out of the light test because lighting and night vision both need the
 * same question answered — "is there a wall between these two points?" — and
 * the polygon machinery above is far more than either needs.
 */
export function hasLineOfSight(from, to, segments) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  // Coincident points: nothing can lie strictly between them.
  if (dist < 1e-9) return true
  const ux = dx / dist
  const uy = dy / dist
  for (const seg of segments) {
    const t = rayHit(from, ux, uy, seg)
    // A wall strictly between the two blocks it; one at or past the far point
    // does not.
    if (t !== null && t < dist - 1e-6) return false
  }
  return true
}

/**
 * Which of the authored lights illuminate a point.
 *
 * The test is **the light's** radius, not the token's: a torch on a table
 * across the room lights the room, and a token standing anywhere inside that
 * radius is lit by it. The earlier version compared the distance against the
 * token's own reach, which meant a light only appeared once the token walked
 * on top of it — the room stayed dark right up until the token entered the
 * glow, which is the opposite of how light works and made the preview
 * useless for the question it exists to answer.
 *
 * A light behind a closed door still must not brighten the room the token is
 * in, so reach alone is not enough — the segment between the two must also be
 * clear.
 *
 * `range: 0` is treated as a light with no limit rather than a dead one: the
 * format uses 0 for an unbounded light, and rendering that as "lights nothing"
 * would silently drop it.
 */
export function reachingLights(origin, lights, segments) {
  return (lights || []).filter((light) => {
    if (!light?.position) return false
    const dist = Math.hypot(light.position.x - origin.x, light.position.y - origin.y)
    // Standing inside the light is always lit.
    if (dist < 1e-9) return true
    if (light.range > 0 && dist > light.range) return false
    return hasLineOfSight(origin, light.position, segments)
  })
}

/**
 * Is the point lit at all — by ambient light, the token's own light, or any
 * placed light that reaches it?
 *
 * This is what a token with vision but no night vision depends on: such a
 * token sees where there is light and nowhere else, so somewhere unlit is
 * hidden from it even with a clear line of sight.
 */
export function isLit({ origin, lights, segments, tokenLight = 0, ambient = 0 }) {
  if (ambient > 0.02) return true
  if (tokenLight > 0) return true
  return reachingLights(origin, lights, segments).length > 0
}

/** An SVG path `d` for a polygon, in whatever space the points are already in. */
export function polygonPath(points) {
  if (!points || points.length === 0) return ''
  return `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')} Z`
}

/**
 * The lit-and-visible region around a token, as a set of polygons to fill.
 *
 * This is the piece that makes the preview behave like a VTT rather than like
 * a hole cut in a black sheet. Three things reveal ground, and they compose:
 *
 * - **Night vision** reveals within its distance whether or not there is light
 *   there. Bounded, because darkvision always is.
 * - **The token's own light** reveals within its radius — a carried torch.
 * - **Each placed light that the token can see** reveals *the light's* own
 *   visible area, intersected with the token's. This is the fix for the
 *   complaint: a brazier across the hall lights the hall, and the token sees
 *   that lit ground from where it stands, instead of the room staying black
 *   until the token is standing in the fire.
 *
 * Every one of these is clipped to the token's own sight polygon by the
 * caller's mask, so nothing leaks through a wall. What is returned is the
 * *unclipped* set; the renderer intersects them.
 *
 * A light's polygon is computed from the light's position, which is what makes
 * a lit room visible around a corner the light can reach but the token cannot
 * see past — exactly the behaviour that distinguishes a real lighting model
 * from overlaid circles.
 */
export function litRegions({
  token,
  lights,
  segments,
  nightVision = 0,
  tokenLight = 0,
  hasVision = true,
}) {
  const regions = []
  if (!token || !hasVision) return regions

  // Darkvision: sees regardless of light, bounded by its distance and by walls.
  if (nightVision > 0) {
    regions.push({
      kind: 'night',
      polygon: computeVisibility(token, segments, nightVision),
    })
  }

  // The carried torch.
  if (tokenLight > 0) {
    regions.push({
      kind: 'token-light',
      polygon: computeVisibility(token, segments, tokenLight),
    })
  }

  // Every placed light contributes its *own* visible area — the ground that
  // light actually falls on, not a disc around the token.
  //
  // Deliberately not gated on the token being able to see the lamp itself.
  // Light spilling from a brazier around a corner lands on floor the token can
  // see, even while the brazier is hidden behind the corner; requiring line of
  // sight to the source would black that floor out. The caller intersects each
  // region with the token's own sight polygon, and that intersection is what
  // correctly hides the part of the lit area the token cannot see.
  for (const light of lights || []) {
    if (!light?.position) continue
    regions.push({
      kind: 'light',
      light,
      polygon: computeVisibility(light.position, segments, light.range),
    })
  }
  return regions
}
