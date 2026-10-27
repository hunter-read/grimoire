/**
 * Geometry for cut-outs (issue #207). Pure functions, no DOM.
 *
 * A cut-out is stored against the pages it covers - one page, or two facing
 * pages when it runs across the gutter - with x/y/w/h as fractions (0-1) of
 * those pages laid side by side at a common height. That is the same frame the
 * server renders in, so what is drawn is exactly what is exported.
 *
 * The stage shows one page or a spread. `toStage` maps a stored cut-out into the
 * stage's frame for drawing; `fromStage` maps an edited box back, choosing the
 * narrowest page set that holds it, so a token drawn on the right-hand page of a
 * spread is saved as "page 13" and still shows up in single-page view.
 */

import type { Schema } from '../../../api'

/** A point as fractions of the stage. */
export interface Point {
  x: number
  y: number
}

/** A box as fractions (0-1) of its frame. */
export interface Box extends Point {
  w: number
  h: number
}

/** A box stored against the pages it covers. */
export interface PageBox extends Box {
  pages: number[]
}

/** A page's size in PDF points. */
export type PageSize = Schema<'PageSizeResponse'>

/** Page number -> its point size, for the pages fetched so far. */
export type PageSizes = Record<number, PageSize>

/** One page's slot in a layout: where it starts and how wide it is. */
export interface LayoutPart {
  page: number
  offset: number
  width: number
}

/** Pages laid side by side at a common height, in PDF points. */
export interface Layout {
  pages: number[]
  parts: LayoutPart[]
  width: number
  height: number
}

/** A box corner, or edge for a resize handle: 'n', 'se', ... */
export type Handle = string

interface SquareOptions {
  square?: boolean
  aspect?: number
}

/** Smallest side, as a fraction of the stage, that counts as a deliberate box. */
export const MIN_SIZE = 0.01

/**
 * Lay pages out left to right at the first page's height, in PDF points.
 * `sizes` maps page -> { width, height }. Returns null until every size is known.
 */
export function layoutFor(pages: number[], sizes: PageSizes): Layout | null {
  if (!pages.length || pages.some((p) => !sizes[p])) return null
  const height = sizes[pages[0]].height
  let offset = 0
  const parts = pages.map((page) => {
    const s = sizes[page]
    const scale = s.height ? height / s.height : 1
    const part = { page, offset, width: s.width * scale }
    offset += part.width
    return part
  })
  return { pages, parts, width: offset, height }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Clamp a box into the unit square, keeping its size where possible. */
export function clampBox<B extends Box>(box: B): B {
  const w = Math.min(box.w, 1)
  const h = Math.min(box.h, 1)
  return {
    ...box,
    w,
    h,
    x: Math.min(Math.max(box.x, 0), 1 - w),
    y: Math.min(Math.max(box.y, 0), 1 - h),
  }
}

/** The stage-frame box for a cut-out, or null when it is not on this stage. */
export function toStage(cutout: PageBox, layout: Layout | null): Box | null {
  if (!layout) return null
  const key = cutout.pages.join(',')
  if (key === layout.pages.join(',')) {
    return { x: cutout.x, y: cutout.y, w: cutout.w, h: cutout.h }
  }
  if (cutout.pages.length !== 1) return null
  const part = layout.parts.find((p) => p.page === cutout.pages[0])
  if (!part) return null
  return {
    x: (part.offset + cutout.x * part.width) / layout.width,
    y: cutout.y,
    w: (cutout.w * part.width) / layout.width,
    h: cutout.h,
  }
}

/**
 * Map a stage-frame box back to page coordinates: `{ pages, x, y, w, h }`.
 * A box that sits wholly on one page of a spread is stored against that page.
 */
export function fromStage(box: Box, layout: Layout): PageBox {
  const b = clampBox(box)
  if (layout.parts.length > 1) {
    const x0 = b.x * layout.width
    const x1 = (b.x + b.w) * layout.width
    // A hair of tolerance, so a box snapped to the gutter is not read as
    // straddling it because of floating-point noise.
    const eps = layout.width * 1e-6
    const part = layout.parts.find((p) => x0 >= p.offset - eps && x1 <= p.offset + p.width + eps)
    if (part) {
      return {
        pages: [part.page],
        x: clamp01((x0 - part.offset) / part.width),
        y: b.y,
        w: Math.min(1, (x1 - x0) / part.width),
        h: b.h,
      }
    }
  }
  return { pages: [...layout.pages], x: b.x, y: b.y, w: b.w, h: b.h }
}

/**
 * Make a box square on the page (not on the stage, whose fractions are of a
 * non-square frame). `aspect` is the stage's width / height. The box keeps the
 * corner given by `anchor` ('nw' | 'ne' | 'sw' | 'se') fixed.
 */
export function squareUp(box: Box, aspect: number, anchor: Handle = 'nw'): Box {
  // Side length in "height units": w * aspect is the width in the same units.
  const side = Math.max(box.w * aspect, box.h)
  let w = side / aspect
  let h = side
  // Shrink rather than spill past the edge of the stage.
  const fit = Math.min(1, 1 / Math.max(w, h, 1e-9))
  w *= fit
  h *= fit
  // The anchored corner's own coordinates: its left or right edge, top or bottom.
  const fixedX = anchor.includes('w') ? box.x : box.x + box.w
  const fixedY = anchor.includes('n') ? box.y : box.y + box.h
  const x = anchor.includes('w') ? fixedX : fixedX - w
  const y = anchor.includes('n') ? fixedY : fixedY - h
  return clampBox({ x, y, w, h })
}

/** The box spanned by a drag from `a` to `b` (both {x, y} stage fractions). */
export function boxFromDrag(
  a: Point,
  b: Point,
  { square = false, aspect = 1 }: SquareOptions = {}
): Box {
  const x0 = clamp01(Math.min(a.x, b.x))
  const y0 = clamp01(Math.min(a.y, b.y))
  const x1 = clamp01(Math.max(a.x, b.x))
  const y1 = clamp01(Math.max(a.y, b.y))
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  if (!square) return box
  // The anchor is the corner the drag started from, so the square grows toward
  // the pointer whichever way it is dragged.
  const anchor = `${b.y >= a.y ? 'n' : 's'}${b.x >= a.x ? 'w' : 'e'}`
  const anchored = {
    x: anchor.includes('w') ? a.x : a.x - box.w,
    y: anchor.includes('n') ? a.y : a.y - box.h,
    w: box.w,
    h: box.h,
  }
  return squareUp(anchored, aspect, anchor)
}

/** Move a box by (dx, dy), stopping at the stage edges. */
export function moveBox<B extends Box>(box: B, dx: number, dy: number): B {
  return clampBox({ ...box, x: box.x + dx, y: box.y + dy })
}

/** The corner opposite a handle, which stays put while that handle is dragged. */
const OPPOSITE: Record<string, string> = { n: 's', s: 'n', e: 'w', w: 'e' }

/**
 * Resize `box` by dragging `handle` ('n', 'se', ...) by (dx, dy). With `square`,
 * the result stays square on the page, anchored at the opposite corner.
 */
export function resizeBox(
  box: Box,
  handle: Handle,
  dx: number,
  dy: number,
  { square = false, aspect = 1 }: SquareOptions = {}
): Box {
  let x0 = box.x
  let y0 = box.y
  let x1 = box.x + box.w
  let y1 = box.y + box.h
  if (handle.includes('w')) x0 = clamp01(Math.min(x0 + dx, x1 - MIN_SIZE))
  if (handle.includes('e')) x1 = clamp01(Math.max(x1 + dx, x0 + MIN_SIZE))
  if (handle.includes('n')) y0 = clamp01(Math.min(y0 + dy, y1 - MIN_SIZE))
  if (handle.includes('s')) y1 = clamp01(Math.max(y1 + dy, y0 + MIN_SIZE))
  const next = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  if (!square) return next
  const v = handle.includes('n') ? 's' : 'n'
  const hz = handle.includes('w') ? 'e' : 'w'
  // An edge handle on a square box drags one side; the anchor is the far edge.
  const anchor = handle.length === 2 ? `${OPPOSITE[handle[0]]}${OPPOSITE[handle[1]]}` : `${v}${hz}`
  return squareUp(next, aspect, anchor)
}

/** Whether a box is too small to have been meant (a click, not a drag). */
export function isTiny(box: Pick<Box, 'w' | 'h'>): boolean {
  return box.w < MIN_SIZE || box.h < MIN_SIZE
}

/**
 * Pixel size a cut-out renders to at `dpi`, from the point sizes of its pages.
 * Null until the sizes are known.
 */
export function pixelSize(
  cutout: Pick<PageBox, 'pages' | 'w' | 'h'>,
  sizes: PageSizes,
  dpi: number
): { width: number; height: number } | null {
  const layout = layoutFor(cutout.pages, sizes)
  if (!layout) return null
  const k = dpi / 72
  return {
    width: Math.max(1, Math.round(cutout.w * layout.width * k)),
    height: Math.max(1, Math.round(cutout.h * layout.height * k)),
  }
}

/** Intersection over union of two boxes in the same frame (0 = apart, 1 = same). */
export function overlap(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const inter = ix * iy
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}
