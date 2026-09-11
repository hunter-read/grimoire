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

  // Aim at every endpoint, plus a hair either side so a ray can round the
  // corner and light what is behind it. Without the nudged pair, the polygon
  // stops dead at each corner and produces visible notches.
  const angles = []
  for (const seg of segments) {
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
    for (const seg of segments) {
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
 * Which of the authored lights actually reach a point, and are visible from it.
 *
 * A light behind a closed door should not brighten the room the token is in,
 * so reach alone is not enough: the segment between light and token must also
 * be clear. This is a single ray test per light rather than a full polygon —
 * the preview shades by visibility from the *token*, so a light only needs to
 * answer whether it contributes at all.
 */
export function visibleLights(origin, lights, segments) {
  return (lights || []).filter((light) => {
    const dx = light.position.x - origin.x
    const dy = light.position.y - origin.y
    const dist = Math.hypot(dx, dy)
    // Standing inside the light is always lit, and a zero-length ray has no
    // direction to test.
    if (dist < 1e-9) return true
    if (light.range > 0 && dist > light.range) return false
    const ux = dx / dist
    const uy = dy / dist
    for (const seg of segments) {
      const t = rayHit(origin, ux, uy, seg)
      // A wall strictly between the two blocks it; one at or past the light
      // itself does not.
      if (t !== null && t < dist - 1e-6) return false
    }
    return true
  })
}

/** An SVG path `d` for a polygon, in whatever space the points are already in. */
export function polygonPath(points) {
  if (!points || points.length === 0) return ''
  return `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')} Z`
}
