/**
 * The grid overlay both the calibration step and the editor canvas draw.
 *
 * Shared rather than duplicated because two subtleties have to be right in
 * both, and they are not obvious:
 *
 * 1. **The line must be a plain `linear-gradient`, not a repeating one.**
 *    `repeating-linear-gradient(..., gold 0 1px, transparent 1px 100%)` sets
 *    its own repeat period to 100% of the positioning area, which means
 *    `background-size` never controls the spacing — the lines land wherever
 *    that period happens to fall, so a 21x18 grid drew neither 21 nor 18 lines.
 *    A plain gradient has no period of its own, so the tile size *is* the pitch.
 *
 * 2. **The line width must scale with the zoom.** The overlay lives inside the
 *    pan/zoom transform, so a 1px line at 22% zoom is 0.22 screen pixels: the
 *    browser drops or dithers it, and which lines survive comes down to
 *    rounding. Dividing by the scale keeps every line one screen pixel wide at
 *    any zoom, which is what makes the grid readable on a big battlemap.
 *
 * Drawn as a tiled gradient rather than as DOM nodes or SVG lines because a
 * 60x80 grid is 140 elements, and nudging the cell size would rebuild all of
 * them on every keystroke.
 */

/**
 * Background style for a grid of `cellPx` cells offset by `offset`, viewed at
 * `scale`. Returns null when there is no grid to draw yet.
 */
export function gridOverlayStyle(cellPx, offset, scale = 1, opacity = 0.55) {
  if (!cellPx || cellPx <= 0) return null
  // One screen pixel, expressed in image pixels. Floored at a hair above zero
  // so a pathological scale cannot produce a zero-width (invisible) line.
  const line = Math.max(0.5, 1 / (scale || 1))
  return {
    backgroundImage:
      `linear-gradient(to right, var(--gold) 0 ${line}px, transparent ${line}px),` +
      `linear-gradient(to bottom, var(--gold) 0 ${line}px, transparent ${line}px)`,
    backgroundSize: `${cellPx}px ${cellPx}px, ${cellPx}px ${cellPx}px`,
    backgroundPosition: `${offset.x}px ${offset.y}px`,
    opacity,
  }
}
