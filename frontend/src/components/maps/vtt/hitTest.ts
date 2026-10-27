import { distance, distanceToPolyline } from './geometry'

/**
 * Picking a feature out from under the cursor.
 *
 * Two things made the old inline version hard to click accurately, and both
 * are fixed here.
 *
 * **1. The tolerance ignored the zoom.** It was a flat third of a grid square
 * in document space, so zooming in did not actually help: the wall got bigger
 * on screen while its catchment stayed exactly the same size in grid units,
 * and two features a tenth of a cell apart stayed impossible to separate no
 * matter how far in you went. Zooming in to click something precisely is the
 * obvious move, and it did nothing. Tolerance is now derived from a constant
 * number of *screen pixels* converted back into grid units, so it shrinks as
 * you zoom in — which is what makes the zoom do the work.
 *
 * **2. A light could not be clicked through the wall it sits on.** A light's
 * marker is a *solid drawn dot*, not a point, but hit-testing compared its
 * centre distance against every wall's and took the nearest. A wall crossing
 * under the dot is almost always nearer than the dot's centre, so clicking the
 * circle you can plainly see selected — and then deleted — the wall behind it.
 *
 * The fix is to treat the marker as the shape it is drawn as. A click *inside*
 * a light's dot selects that light outright, before walls are considered at
 * all: within the circle there is nothing to arbitrate, because the dot is
 * painted on top and is unambiguously what the user aimed at. Only outside
 * every dot do the line features compete, and there they compete on plain
 * distance, which is the right answer for two walls near each other.
 *
 * Normalising scores across feature types was tried first and is not enough:
 * with a 12px dot against a 10px wall tolerance, a wall only has to be ~17%
 * nearer than your offset from the light's centre to win, so clicking slightly
 * off-centre on a light still picked the wall.
 */

/**
 * Hit tolerance in screen pixels.
 *
 * Roughly a finger-width of slack at 100%: forgiving enough that a wall does
 * not demand pixel accuracy, tight enough that two features a few pixels apart
 * stay separable. Because this is in screen space, zooming in narrows it in
 * document terms and lets you pick between features that overlap at 100%.
 */
export const HIT_PIXELS = 10

/**
 * Radius of a light's marker dot, in screen pixels.
 *
 * The canvas draws the dot at exactly this size and the hit test accepts
 * exactly this radius, which is what makes "I clicked the circle" and "the
 * circle got selected" the same statement. They were separate numbers before,
 * and drifted apart at low zoom where the drawn radius hit a floor.
 */
export const LIGHT_MARKER_PX = 8

/** Click slack around a light, a little beyond the dot itself. */
export const LIGHT_PIXELS = LIGHT_MARKER_PX + 4

/**
 * Convert a screen-pixel slack into grid units.
 *
 * `cellPx` is image pixels per grid square and `scale` is the viewport zoom, so
 * one screen pixel is `1 / (cellPx * scale)` grid units. Guarded because a zero
 * cell size would otherwise hand back Infinity and select the whole map.
 */
export function gridTolerance(pixels, cellPx, scale = 1) {
  const denom = cellPx * (scale || 1)
  if (!denom || denom <= 0) return 0
  return pixels / denom
}

/**
 * The feature under `pt`, or null.
 *
 * `pt` is in grid units; `cellPx` and `scale` describe the current view so the
 * tolerance can be kept constant on screen. Returns `{ key, index }` naming the
 * document array and position, ready to use as a selection.
 */
export function hitTest(doc, pt, { cellPx, scale = 1 } = {}) {
  if (!doc) return null
  const lineReach = gridTolerance(HIT_PIXELS, cellPx, scale)
  const lightReach = gridTolerance(LIGHT_PIXELS, cellPx, scale)
  if (lineReach <= 0 && lightReach <= 0) return null

  // Lights win outright inside their marker, because the marker is a solid dot
  // drawn on top of everything else — a click within it is not ambiguous, and
  // letting a wall underneath compete is exactly the bug. The nearest light
  // still wins against other lights, so overlapping dots stay selectable.
  let nearestLight = null
  doc.lights?.forEach((light, index) => {
    if (!light?.position) return
    const d = distance(pt, light.position)
    if (d <= lightReach && (!nearestLight || d < nearestLight.d)) {
      nearestLight = { key: 'lights', index, d }
    }
  })
  if (nearestLight) return { key: nearestLight.key, index: nearestLight.index }

  // Outside every dot, the line features compete on plain distance: for two
  // walls near each other, nearest is simply the right answer.
  let best = null
  const consider = (key, index, d) => {
    if (d <= lineReach && (!best || d < best.d)) best = { key, index, d }
  }
  for (const key of ['line_of_sight', 'objects_line_of_sight']) {
    doc[key]?.forEach((line, index) => consider(key, index, distanceToPolyline(pt, line)))
  }
  doc.portals?.forEach((portal, index) => {
    if (!portal?.bounds) return
    consider('portals', index, distanceToPolyline(pt, portal.bounds))
  })

  return best ? { key: best.key, index: best.index } : null
}
