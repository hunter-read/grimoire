import { useState, useCallback, useEffect, useRef } from 'react'

// Zoom bounds and granularity. Up to 8x (issue #574). The whole-page image can
// only be re-fetched sharp up to the render endpoint's 3000px cap; past that
// the reader lays sharp tiles of just the visible area over it (ZoomTiles), so
// the ceiling is no longer where the bitmap goes soft (issue #249).
export const MIN_ZOOM = 1
export const MAX_ZOOM = 8
export const ZOOM_STEP = 0.25
// The stops the zoom buttons and +/- keys step through: fine steps where small
// changes matter, coarser ones higher up so 8x is not 28 presses away.
export const ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8]

// Past this zoom level, re-request the page at a higher render width so text
// stays crisp. Below it the base width is already sharp enough.
export const HIDPI_THRESHOLD = 1.5
// Server-side ceiling on the page endpoint's `width` query param.
export const MAX_RENDER_WIDTH = 3000

export const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

/** Round to the nearest step, to quantise the whole-page render width. */
const snap = (z) => Math.round(z / ZOOM_STEP) * ZOOM_STEP

// Wheel and pinch land between stops; a hair of slack keeps 1.2499 from
// counting as below 1.25.
const EPSILON = 1e-3

/** The next stop above `z`, or MAX_ZOOM. */
export const nextZoomLevel = (z) => ZOOM_LEVELS.find((l) => l > z + EPSILON) ?? MAX_ZOOM

/** The next stop below `z`, or MIN_ZOOM. */
export const prevZoomLevel = (z) =>
  [...ZOOM_LEVELS].reverse().find((l) => l < z - EPSILON) ?? MIN_ZOOM

/**
 * The pan for a page turned while zoomed: same zoom, same column, but at the
 * top of the new page when reading forward and the bottom when going back, the
 * way a continuous scroll would arrive there.
 *
 * Measured on the page being left, since the next one is not laid out yet;
 * pages in one book share a size. `top`/`bottom` are the page's screen edges and
 * `viewHeight` the reader's, both relative to the reader's centre, so they work
 * straight from getBoundingClientRect(). Pan is pre-scale (the transform is
 * `scale(z) translate(pan)`), hence the divisions by zoom.
 */
export function panForTurn({ direction, zoom, pan, top, bottom, viewHeight, margin = 12 }) {
  const pageTop = top / zoom - pan.y
  const pageBottom = bottom / zoom - pan.y
  const halfView = viewHeight / 2 / zoom
  // A page that fits on screen at this zoom is simply centred.
  if (pageBottom - pageTop <= 2 * halfView) return { x: pan.x, y: 0 - (pageTop + pageBottom) / 2 }
  const inset = margin / zoom
  const y = direction >= 0 ? -halfView + inset - pageTop : halfView - inset - pageBottom
  return { x: pan.x, y }
}

/**
 * The render width to request for a page at a given zoom. Returns the base width
 * until zoom crosses HIDPI_THRESHOLD, then the width needed to render 1:1 at that
 * zoom, capped at what the server accepts.
 *
 * Quantised to whole steps so panning around at one zoom level doesn't churn
 * through cache entries — each step maps to exactly one cached image per page.
 */
export function renderWidthFor(baseWidth, zoom) {
  if (zoom <= HIDPI_THRESHOLD) return baseWidth
  const wanted = Math.round(baseWidth * snap(zoom))
  return Math.min(MAX_RENDER_WIDTH, Math.max(baseWidth, wanted))
}

/**
 * Zoom and pan state for the reader, shared by the toolbar buttons, keyboard
 * shortcuts, and the wheel handler so all three drive identical logic.
 *
 * `zoomAt` anchors the zoom on a point (the cursor) rather than the element
 * centre. Without this, zooming past ~1.5x walks the region of interest off
 * screen and you have to pan back to what you were looking at.
 *
 * `resetKey` resets zoom and pan when it changes - the book and view mode, not
 * the page: zoom carries across page turns (see panForTurn).
 *
 * @returns {{zoom, pan, setPan, zoomIn, zoomOut, resetZoom, zoomAt, canZoomIn, canZoomOut, isZoomed}}
 */
export default function useReaderZoom({ resetKey } = {}) {
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  // Handlers live in native (non-React) wheel listeners, so they need refs to
  // read current values without being re-bound on every change.
  const zoomRef = useRef(MIN_ZOOM)
  const panRef = useRef({ x: 0, y: 0 })

  const apply = useCallback((nextZoom, nextPan) => {
    zoomRef.current = nextZoom
    panRef.current = nextPan
    setZoom(nextZoom)
    setPan(nextPan)
  }, [])

  useEffect(() => {
    apply(MIN_ZOOM, { x: 0, y: 0 })
  }, [resetKey, apply])

  /**
   * Zoom to an absolute level, keeping the point (originX, originY) visually
   * fixed. Origins are offsets from the element centre in CSS pixels; omit them
   * (or pass 0,0) to zoom about the centre, which is what the buttons and
   * keyboard shortcuts do.
   *
   * Pan is stored pre-scale (the transform is `scale(z) translate(pan)`), so the
   * origin correction divides by each zoom level rather than multiplying.
   */
  const zoomTo = useCallback(
    (target, originX = 0, originY = 0) => {
      const from = zoomRef.current
      const to = clampZoom(target)
      if (to === from) return
      if (to === MIN_ZOOM) {
        apply(MIN_ZOOM, { x: 0, y: 0 })
        return
      }
      const p = panRef.current
      apply(to, {
        x: p.x + originX / to - originX / from,
        y: p.y + originY / to - originY / from,
      })
    },
    [apply]
  )

  const zoomIn = useCallback(() => zoomTo(nextZoomLevel(zoomRef.current)), [zoomTo])
  const zoomOut = useCallback(() => zoomTo(prevZoomLevel(zoomRef.current)), [zoomTo])
  const resetZoom = useCallback(() => apply(MIN_ZOOM, { x: 0, y: 0 }), [apply])

  /** Continuous zoom by a relative delta, anchored at a point. For the wheel. */
  const zoomAt = useCallback(
    (delta, originX, originY) => zoomTo(zoomRef.current + delta, originX, originY),
    [zoomTo]
  )

  const setPanBoth = useCallback((next) => {
    const value = typeof next === 'function' ? next(panRef.current) : next
    panRef.current = value
    setPan(value)
  }, [])

  /**
   * Set an absolute zoom without moving the anchor, clearing pan on the way back
   * to 1x. Used by pinch, which tracks the gesture's own scale factor and so
   * can't go through the stepped helpers.
   */
  const setZoomDirect = useCallback((next) => {
    const to = clampZoom(next)
    zoomRef.current = to
    setZoom(to)
    if (to === MIN_ZOOM) {
      panRef.current = { x: 0, y: 0 }
      setPan({ x: 0, y: 0 })
    }
  }, [])

  return {
    zoom,
    pan,
    setPan: setPanBoth,
    setZoomDirect,
    zoomRef,
    panRef,
    zoomIn,
    zoomOut,
    resetZoom,
    zoomAt,
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > MIN_ZOOM,
    isZoomed: zoom !== MIN_ZOOM,
  }
}
