/**
 * Coordinate maths for the Universal VTT editor (issues #126/#127).
 *
 * Three spaces are in play and confusing them is the classic source of bugs in
 * VTT tooling, so they are named consistently everywhere in the editor:
 *
 * - **image**  pixels on the source raster, origin top-left. What the user sees.
 * - **grid**   grid squares, fractional, measured at grid *intersections*. What
 *              the `.uvtt` file stores, and what we persist.
 * - **screen** pixels in the canvas viewport, after pan and zoom.
 *
 * The grid may not start at the image's top-left — battlemaps routinely carry a
 * margin — so image→grid subtracts a calibrated `offset` before dividing by the
 * cell size. That offset is what the calibration step exists to find.
 */

/** Image pixels → grid units, honouring the calibrated origin offset. */
export function imageToGrid(pt, cellPx, offset = { x: 0, y: 0 }) {
  return {
    x: (pt.x - offset.x) / cellPx,
    y: (pt.y - offset.y) / cellPx,
  }
}

/** Grid units → image pixels. The exact inverse of {@link imageToGrid}. */
export function gridToImage(pt, cellPx, offset = { x: 0, y: 0 }) {
  return {
    x: pt.x * cellPx + offset.x,
    y: pt.y * cellPx + offset.y,
  }
}

/** Round to the stored precision (4dp) — sub-pixel at any real cell size. */
export const round4 = (n) => Math.round(n * 10000) / 10000

/**
 * Snap a grid-space point to the nearest intersection.
 *
 * Snapping targets intersections rather than cell centres because that is where
 * walls belong: a wall runs along the edge between two cells, not through them.
 */
export function snapToGrid(pt) {
  return { x: Math.round(pt.x), y: Math.round(pt.y) }
}

/** Snap to the nearest half-cell, for walls that legitimately split a square. */
export function snapToHalf(pt) {
  return { x: Math.round(pt.x * 2) / 2, y: Math.round(pt.y * 2) / 2 }
}

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Distance from point `p` to segment `a`–`b`, all in the same space.
 *
 * Used for hit-testing: clicking "on" a wall means clicking near any of its
 * segments, not near a vertex.
 */
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return distance(p, a)
  // Projection parameter, clamped so the foot of the perpendicular stays on
  // the segment rather than running off its infinite line.
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/** Shortest distance from `p` to any segment of a polyline. */
export function distanceToPolyline(p, points) {
  if (!points || points.length === 0) return Infinity
  if (points.length === 1) return distance(p, points[0])
  let best = Infinity
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = distanceToSegment(p, points[i], points[i + 1])
    if (d < best) best = d
  }
  return best
}

/**
 * Cell size and origin offset implied by two or more picked grid intersections.
 *
 * **Currently unused.** The pick-two-intersections UI was taken out of the
 * calibrator, which now offers the cell counts and the direct nudges instead.
 * This is kept rather than deleted: the geometry is the hard part, it is
 * covered by tests, and bringing the feature back should mean rebuilding the
 * interaction rather than re-deriving the maths.
 *
 * The user clicks intersections they can see and says how many cells apart they
 * are; the spacing between the extremes, divided by that span, is the cell
 * size. Using the *extremes* rather than adjacent pairs is deliberate: picking
 * two points ten cells apart divides the user's clicking error by ten, which is
 * what makes a hand-picked calibration more accurate than counting one square.
 *
 * Each axis is solved independently and only from points that actually span
 * that axis, so a horizontal pick calibrates x and leaves y to another pick or
 * to the square-cell fallback.
 */
export function calibrateFromPoints(points, spanX, spanY) {
  if (!points || points.length < 2) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)

  const cellX = spanX > 0 && width > 0 ? width / spanX : null
  const cellY = spanY > 0 && height > 0 ? height / spanY : null
  // Cells are square on every real battlemap, so one solved axis answers both.
  // Averaging when both are available cancels a little of the click error.
  const cell = cellX && cellY ? (cellX + cellY) / 2 : (cellX ?? cellY)
  if (!cell || cell <= 0) return null

  // The offset is where the grid's own origin falls, which is the picked point
  // walked back by whole cells until it is inside the first cell of the image.
  const originX = Math.min(...xs)
  const originY = Math.min(...ys)
  return {
    cellPx: round4(cell),
    offset: {
      x: round4(((originX % cell) + cell) % cell),
      y: round4(((originY % cell) + cell) % cell),
    },
  }
}

/**
 * Grid dimensions of an image, given a cell size and origin offset.
 *
 * Rounded to 2dp rather than to whole cells: maps routinely bleed a partial
 * cell past the grid, and the format's `map_size` is numeric for that reason.
 */
export function gridDimensions(pixelWidth, pixelHeight, cellPx, offset = { x: 0, y: 0 }) {
  if (!cellPx || cellPx <= 0) return { width: 0, height: 0 }
  return {
    width: Math.round(((pixelWidth - offset.x) / cellPx) * 100) / 100,
    height: Math.round(((pixelHeight - offset.y) / cellPx) * 100) / 100,
  }
}

/** True when the two endpoints of a polyline coincide — a closed room. */
export function isClosed(points) {
  if (!points || points.length < 3) return false
  const a = points[0]
  const b = points[points.length - 1]
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}
