import { useRef, useEffect } from 'react'
import { MIN_ZOOM, MAX_ZOOM } from './useReaderZoom'

// Largest zoom change a single wheel event may cause, so a fast flick on a mouse
// wheel doesn't jump the whole range at once.
const ZOOM_WHEEL_STEP = 0.15

/**
 * Manages wheel, pinch-to-zoom, pan, and swipe gesture navigation for the reader.
 *
 * Zoom state itself lives in `useReaderZoom`, shared with the toolbar and the
 * keyboard shortcuts; this hook only drives it from gestures.
 *
 * @param {object} opts
 * @param {string}   opts.mode        - 'page' | 'spread' | 'pdf'
 * @param {number}   opts.currentPage
 * @param {number}   opts.zoom
 * @param {object}   opts.pan         - { x, y }
 * @param {object}   opts.zoomRef     - live zoom, for native listeners
 * @param {object}   opts.panRef      - live pan, for native listeners
 * @param {Function} opts.setPan
 * @param {Function} opts.setZoomDirect - absolute zoom set, for pinch
 * @param {Function} opts.zoomAt      - (delta, originX, originY) => void
 * @param {Function} opts.goToPage    - (page, mode?, axis?) => void
 * @param {object}   opts.contentRef  - ref to the scrollable content container
 * @param {string}   opts.wheelAction - 'page' | 'zoom' | 'none'
 *
 * @returns {{ handleTouchStart, handleTouchMove, handleTouchEnd, handleMouseDown }}
 */
export default function useReaderGestures({
  mode,
  currentPage,
  zoom,
  pan,
  zoomRef,
  panRef,
  setPan,
  setZoomDirect,
  zoomAt,
  goToPage,
  contentRef,
  wheelAction = 'page',
}) {
  const gestureRef = useRef(null)
  const touchStartRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const longPressFiredRef = useRef(false)
  const lastWheelRef = useRef(0)

  // Wheel: zoom or page, per the user's preference. Paging stays throttled to
  // 500 ms to avoid skipping several pages per flick; zooming deliberately is
  // not throttled, since dropping frames there just feels broken.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const handleWheel = (e) => {
      if (mode === 'pdf') return

      // Ctrl/Cmd + wheel is the browser-wide zoom convention, so honour it
      // whatever the preference is — people reach for it first.
      const wantsZoom = e.ctrlKey || e.metaKey || wheelAction === 'zoom'

      if (wantsZoom) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        // Cursor offset from the element centre: zooming about the centre walks
        // whatever you were reading off screen past ~1.5x.
        const originX = e.clientX - (rect.left + rect.width / 2)
        const originY = e.clientY - (rect.top + rect.height / 2)
        // Normalise the wheel delta; trackpads emit many small events and mouse
        // wheels a few large ones, so cap the per-event step.
        const step = Math.max(-ZOOM_WHEEL_STEP, Math.min(ZOOM_WHEEL_STEP, -e.deltaY * 0.002))
        zoomAt(step, originX, originY)
        return
      }

      // Zoomed in with the wheel bound to paging: let the wheel scroll the
      // overflowing page rather than swallowing the event or turning the page.
      if (zoomRef.current > 1) return
      if (wheelAction !== 'page') return

      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelRef.current < 500) return
      lastWheelRef.current = now
      const wheelStep = mode === 'spread' ? 2 : 1
      const absDx = Math.abs(e.deltaX)
      const absDy = Math.abs(e.deltaY)
      if (absDy > absDx) {
        goToPage(currentPage + (e.deltaY > 0 ? wheelStep : -wheelStep), undefined, 'y')
      } else if (absDx > absDy) {
        goToPage(currentPage + (e.deltaX > 0 ? wheelStep : -wheelStep), undefined, 'x')
      }
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [mode, currentPage, wheelAction, goToPage, contentRef, zoomAt, zoomRef])

  // Mouse drag-to-pan while zoomed. The touch path already pans; without this
  // a mouse user who zooms in has no way to reach the rest of the page.
  const handleMouseDown = (e) => {
    if (mode === 'pdf' || zoomRef.current <= 1 || e.button !== 0) return
    // Don't fight text selection over selectable page text.
    if (e.target?.closest?.('[data-selectable]')) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startPan = { ...panRef.current }
    const onMove = (ev) => {
      const z = zoomRef.current
      setPan({
        x: startPan.x + (ev.clientX - startX) / z,
        y: startPan.y + (ev.clientY - startY) / z,
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const getPinchDist = (t1, t2) => {
    const dx = t1.clientX - t2.clientX
    const dy = t1.clientY - t2.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const handleTouchStart = (e) => {
    if (mode === 'pdf') return
    if (e.touches.length === 2) {
      // Two fingers — start pinch
      gestureRef.current = {
        type: 'pinch',
        initialDist: getPinchDist(e.touches[0], e.touches[1]),
        initialZoom: zoom,
        initialPan: { ...pan },
      }
      touchStartRef.current = null
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      longPressFiredRef.current = false
      // Start long-press timer — fires if finger stays still for 500 ms over a text span.
      // touchAction:none suppresses native long-press selection, so we trigger it
      // programmatically via the Selection API instead.
      longPressTimerRef.current = setTimeout(() => {
        const el = document.elementFromPoint(t.clientX, t.clientY)
        if (!el?.closest('[data-selectable]')) return
        const selection = window.getSelection()
        if (!selection) return
        const range = document.createRange()
        range.selectNodeContents(el.closest('[data-selectable]'))
        selection.removeAllRanges()
        selection.addRange(range)
        longPressFiredRef.current = true
      }, 500)

      if (zoom > 1) {
        gestureRef.current = {
          type: 'pan',
          startX: t.clientX,
          startY: t.clientY,
          startPan: { ...pan },
        }
      } else {
        gestureRef.current = { type: 'swipe' }
        touchStartRef.current = { x: t.clientX, y: t.clientY }
      }
    }
  }

  const handleTouchMove = (e) => {
    if (mode === 'pdf' || !gestureRef.current) return
    // Cancel long-press if finger moves more than 10 px
    if (longPressTimerRef.current && e.touches.length === 1) {
      const t = e.touches[0]
      const g = gestureRef.current
      if (
        g.startX !== undefined &&
        (Math.abs(t.clientX - g.startX) > 10 || Math.abs(t.clientY - g.startY) > 10)
      ) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }
    if (gestureRef.current.type === 'pinch' && e.touches.length === 2) {
      const dist = getPinchDist(e.touches[0], e.touches[1])
      const newZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, gestureRef.current.initialZoom * (dist / gestureRef.current.initialDist))
      )
      setZoomDirect(newZoom)
    } else if (gestureRef.current.type === 'pan' && e.touches.length === 1) {
      const dx = (e.touches[0].clientX - gestureRef.current.startX) / zoom
      const dy = (e.touches[0].clientY - gestureRef.current.startY) / zoom
      setPan({ x: gestureRef.current.startPan.x + dx, y: gestureRef.current.startPan.y + dy })
    }
  }

  const handleTouchEnd = (e) => {
    if (mode === 'pdf') return
    clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
    // Long-press fired — selection is active, don't navigate
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false
      gestureRef.current = null
      touchStartRef.current = null
      return
    }
    const type = gestureRef.current?.type
    gestureRef.current = null
    if (type === 'pinch') {
      // Snap back to 1× if barely zoomed
      if (zoomRef.current < 1.15) setZoomDirect(MIN_ZOOM)
      return
    }
    if (type === 'pan') return
    if (!touchStartRef.current) return
    const step = mode === 'spread' ? 2 : 1
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStartRef.current.x
    const dy = t.clientY - touchStartRef.current.y
    touchStartRef.current = null
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    if (absDx > 50 && absDx > absDy) {
      dx < 0
        ? goToPage(currentPage + step, undefined, 'x')
        : goToPage(currentPage - step, undefined, 'x')
    } else if (absDy > 50 && absDy > absDx) {
      dy < 0
        ? goToPage(currentPage + step, undefined, 'y')
        : goToPage(currentPage - step, undefined, 'y')
    }
  }

  return { handleTouchStart, handleTouchMove, handleTouchEnd, handleMouseDown }
}
