// Geometry for the reader's zoom tiles (issue #574). Past the zoom where the
// whole-page image goes soft, ZoomTiles lays sharp squares of just the visible
// area over it, each rendered by GET /books/:id/page/:n/tile.

/** A screen rectangle, in px. */
export interface TileRect {
  left: number
  top: number
  width: number
  height: number
}

/** One tile to fetch; `high` is on screen, `low` the ring around it. */
export interface Tile {
  col: number
  row: number
  priority: 'high' | 'low'
}

// Must match backend/routers/books/tiles.py.
export const TILE_SIZE = 1024
export const TILE_WIDTH_STEP = 256
export const TILE_MAX_WIDTH = 16384

// Tiles are fetched only once the whole-page image is this far short of sharp:
// a few percent of softness isn't visible, and every tile is a server render.
const SOFTNESS_ALLOWED = 1.15

// Above 2x device pixels the extra sharpness isn't visible either, and each
// doubling quadruples the tiles to fetch.
const MAX_DEVICE_PIXEL_RATIO = 2

/**
 * The width, in image pixels, to render the whole page at so it is sharp at
 * `zoom`: one image pixel per device pixel. Rounded up to the server's step so
 * a page has a bounded set of tile grids to cache.
 */
export function tileWidthFor(cssWidth: number, zoom: number, devicePixelRatio = 1): number {
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), MAX_DEVICE_PIXEL_RATIO)
  const wanted = cssWidth * zoom * dpr
  const stepped = Math.ceil(wanted / TILE_WIDTH_STEP) * TILE_WIDTH_STEP
  return Math.min(TILE_MAX_WIDTH, Math.max(TILE_WIDTH_STEP, stepped))
}

/** Whether a page image `imageWidth` pixels wide is too soft to show alone. */
export function needsTiles(tileWidth: number, imageWidth: number): boolean {
  return tileWidth > imageWidth * SOFTNESS_ALLOWED
}

/** Columns and rows of tiles covering a page `width` pixels wide. `aspect` is height / width. */
export function tileGrid(width: number, aspect: number): { cols: number; rows: number } {
  return {
    cols: Math.ceil(width / TILE_SIZE),
    rows: Math.ceil((width * aspect) / TILE_SIZE),
  }
}

/** Where tile `col`/`row` sits on the page, as percentages of the page box. */
export function tileRect(
  col: number,
  row: number,
  width: number,
  aspect: number
): { left: string; top: string; width: string; height: string } {
  const height = width * aspect
  const pct = (n: number) => `${(n * 100).toFixed(4)}%`
  return {
    left: pct((col * TILE_SIZE) / width),
    top: pct((row * TILE_SIZE) / height),
    width: pct(Math.min(TILE_SIZE, width - col * TILE_SIZE) / width),
    height: pct(Math.min(TILE_SIZE, height - row * TILE_SIZE) / height),
  }
}

/**
 * The tiles to show: those overlapping the view, then a ring of `ring` tiles
 * around them fetched at low priority, so a short pan lands on sharp tiles.
 *
 * `box` is the page's on-screen rect (getBoundingClientRect, so zoom and pan
 * included) and `view` the reader's. Visible tiles come first, so they are
 * also requested first.
 */
export function visibleTiles({
  width,
  aspect,
  box,
  view,
  ring = 1,
}: {
  width: number
  aspect: number
  box: TileRect
  view: TileRect
  ring?: number
}): Tile[] {
  if (!(box.width > 0 && box.height > 0)) return []
  const fx0 = (Math.max(view.left, box.left) - box.left) / box.width
  const fx1 = (Math.min(view.left + view.width, box.left + box.width) - box.left) / box.width
  const fy0 = (Math.max(view.top, box.top) - box.top) / box.height
  const fy1 = (Math.min(view.top + view.height, box.top + box.height) - box.top) / box.height
  if (fx1 <= fx0 || fy1 <= fy0) return []

  const { cols, rows } = tileGrid(width, aspect)
  const height = width * aspect
  const clamp = (n: number, max: number) => Math.min(max - 1, Math.max(0, n))
  const c0 = clamp(Math.floor((fx0 * width) / TILE_SIZE), cols)
  const c1 = clamp(Math.ceil((fx1 * width) / TILE_SIZE) - 1, cols)
  const r0 = clamp(Math.floor((fy0 * height) / TILE_SIZE), rows)
  const r1 = clamp(Math.ceil((fy1 * height) / TILE_SIZE) - 1, rows)

  const seen = new Set<string>()
  const tiles: Tile[] = []
  const add = (col: number, row: number, priority: Tile['priority']) => {
    const key = `${col}:${row}`
    if (seen.has(key)) return
    seen.add(key)
    tiles.push({ col, row, priority })
  }
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) add(col, row, 'high')
  const rr0 = clamp(r0 - ring, rows)
  const rr1 = clamp(r1 + ring, rows)
  const rc0 = clamp(c0 - ring, cols)
  const rc1 = clamp(c1 + ring, cols)
  for (let row = rr0; row <= rr1; row++) for (let col = rc0; col <= rc1; col++) add(col, row, 'low')
  return tiles
}
