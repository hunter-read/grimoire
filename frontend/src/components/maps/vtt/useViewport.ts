import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { Point } from './types'

/**
 * Pan/zoom viewport shared by the calibration step and the editor canvas.
 *
 * Zoom is required, not a nicety: calibration asks the user to click grid
 * intersections precisely, and on a 5000px battlemap shown at fit-to-window a
 * single screen pixel covers several image pixels. Being able to zoom in is
 * what makes a hand-picked grid more accurate than the automatic guess.
 *
 * State is `{scale, tx, ty}` — an image point maps to screen as
 * `p * scale + t`. Zooming keeps the point under the cursor fixed, which is the
 * behaviour every map tool has and the only one that feels right when you are
 * aiming at a specific intersection.
 */

const MIN_SCALE = 0.02
const MAX_SCALE = 40

/** An image point maps to screen as `p * scale + t`. */
export interface View {
  scale: number
  tx: number
  ty: number
}

/** What the hook hands back; also what a canvas passes up through `viewportRef`. */
export interface Viewport {
  view: View
  setView: Dispatch<SetStateAction<View>>
  fit: () => void
  toImage: (clientX: number, clientY: number) => Point
  zoomAt: (factor: number, clientX: number, clientY: number) => void
  zoomBy: (factor: number) => void
  startPan: (clientX: number, clientY: number) => void
  movePan: (clientX: number, clientY: number) => boolean
  endPan: () => void
  isPanning: boolean
}

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))

export default function useViewport(
  containerRef: RefObject<HTMLElement | null>,
  imageSize: { width?: number | null; height?: number | null } | null | undefined
): Viewport {
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 })
  // Panning is tracked in a ref: it updates on every mousemove and must not
  // re-render the tool layer while a drag is in flight.
  const panning = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  /** Scale and centre the image so the whole thing is visible. */
  const fit = useCallback(() => {
    const el = containerRef.current
    if (!el || !imageSize?.width || !imageSize?.height) return
    const { clientWidth: cw, clientHeight: ch } = el
    if (!cw || !ch) return
    // A small margin so the map's own edge is not flush against the viewport,
    // which matters when the outermost wall runs along it.
    const scale = clampScale(Math.min(cw / imageSize.width, ch / imageSize.height) * 0.94)
    setView({
      scale,
      tx: (cw - imageSize.width * scale) / 2,
      ty: (ch - imageSize.height * scale) / 2,
    })
  }, [containerRef, imageSize?.width, imageSize?.height])

  // Fit once the image dimensions are known, and again if the map changes.
  useEffect(() => {
    fit()
  }, [fit])

  /** Screen (client) coordinates → image pixels. */
  const toImage = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current
      if (!el) return { x: 0, y: 0 }
      const rect = el.getBoundingClientRect()
      return {
        x: (clientX - rect.left - view.tx) / view.scale,
        y: (clientY - rect.top - view.ty) / view.scale,
      }
    },
    [containerRef, view]
  )

  /** Zoom by a factor, holding the given client point fixed on screen. */
  const zoomAt = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      setView((v) => {
        const scale = clampScale(v.scale * factor)
        if (scale === v.scale) return v
        // Solve for the translation that leaves the image point under the
        // cursor mapping to the same screen position at the new scale.
        const ratio = scale / v.scale
        return { scale, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio }
      })
    },
    [containerRef]
  )

  /** Zoom about the viewport centre — for the toolbar buttons. */
  const zoomBy = useCallback(
    (factor: number) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
    },
    [containerRef, zoomAt]
  )

  const startPan = useCallback(
    (clientX: number, clientY: number) => {
      panning.current = { x: clientX, y: clientY, tx: view.tx, ty: view.ty }
      setIsPanning(true)
    },
    [view.tx, view.ty]
  )

  const movePan = useCallback((clientX: number, clientY: number) => {
    const p = panning.current
    if (!p) return false
    setView((v) => ({ ...v, tx: p.tx + (clientX - p.x), ty: p.ty + (clientY - p.y) }))
    return true
  }, [])

  const endPan = useCallback(() => {
    if (!panning.current) return
    panning.current = null
    setIsPanning(false)
  }, [])

  return { view, setView, fit, toImage, zoomAt, zoomBy, startPan, movePan, endPan, isPanning }
}
