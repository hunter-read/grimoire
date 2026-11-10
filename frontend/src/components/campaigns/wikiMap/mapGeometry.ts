/**
 * The arithmetic behind a map page's canvas (issue #578), kept apart from the
 * component so it can be tested on its own.
 *
 * The picture sits in a wrapper whose CSS transform is `translate(x, y)
 * scale(scale)` with its origin at the top-left. Pins are placed inside that
 * wrapper at fractions of its size (0-1), which is also how they are stored -
 * so a pin stays on its spot at any zoom, and when the map is swapped for a
 * copy at another resolution.
 */

export interface MapView {
  scale: number
  x: number
  y: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 8
export const IDENTITY: MapView = { scale: 1, x: 0, y: 0 }

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * Zoom by `factor`, keeping the point under (`px`, `py`) still.
 *
 * The point is measured from the wrapper's untransformed top-left, which is
 * where its layout box sits before the transform moves it. Back at scale 1 the
 * view snaps home, so zooming all the way out never strands the map off-centre.
 */
export function zoomAt(view: MapView, factor: number, px: number, py: number): MapView {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
  if (scale === MIN_SCALE) return IDENTITY
  const ratio = scale / view.scale
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }
}

/** A pointer position as a fraction of a rendered box, clamped onto it. */
export function toFraction(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
): { x: number; y: number } {
  if (!rect.width || !rect.height) return { x: 0.5, y: 0.5 }
  return {
    x: clamp((clientX - rect.left) / rect.width, 0, 1),
    y: clamp((clientY - rect.top) / rect.height, 0, 1),
  }
}

/**
 * Nudge a pin from the keyboard: arrow keys move it 1% of the map, 5% with
 * Shift. Returns null for any other key.
 */
export function nudge(
  key: string,
  shift: boolean,
  at: { x: number; y: number }
): { x: number; y: number } | null {
  const step = shift ? 0.05 : 0.01
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const move = moves[key]
  if (!move) return null
  return { x: clamp(at.x + move[0], 0, 1), y: clamp(at.y + move[1], 0, 1) }
}

/** Movement under this many pixels is a click, not a drag. */
export const DRAG_THRESHOLD = 4

export const movedPastThreshold = (dx: number, dy: number) => Math.hypot(dx, dy) >= DRAG_THRESHOLD
