import { useRef, useEffect } from 'react'

/**
 * Manages wheel, pinch-to-zoom, pan, and swipe gesture navigation for the reader.
 *
 * @param {object} opts
 * @param {string}   opts.mode        - 'page' | 'spread' | 'pdf'
 * @param {number}   opts.currentPage
 * @param {number}   opts.zoom
 * @param {object}   opts.pan         - { x, y }
 * @param {Function} opts.setZoom
 * @param {Function} opts.setPan
 * @param {Function} opts.goToPage    - (page, mode?, axis?) => void
 * @param {object}   opts.contentRef  - ref to the scrollable content container
 *
 * @returns {{ handleTouchStart, handleTouchMove, handleTouchEnd }}
 */
export default function useReaderGestures({
  mode,
  currentPage,
  zoom,
  pan,
  setZoom,
  setPan,
  goToPage,
  contentRef,
  wheelNav = true,
}) {
  const gestureRef = useRef(null)
  const touchStartRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const longPressFiredRef = useRef(false)
  const lastWheelRef = useRef(0)

  // Wheel navigation — throttled to 500 ms to avoid rapid page-skipping
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const handleWheel = (e) => {
      if (mode === 'pdf') return
      if (zoom > 1) {
        e.preventDefault()
        return
      }
      if (!wheelNav) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheelRef.current < 500) return
      lastWheelRef.current = now
      // Compute step here to avoid capturing stale outer-scope values
      const wheelStep = mode === 'spread' ? (currentPage === 1 ? 1 : 2) : 1
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
  }, [mode, currentPage, zoom, wheelNav, goToPage, contentRef])

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
        1,
        Math.min(4, gestureRef.current.initialZoom * (dist / gestureRef.current.initialDist))
      )
      setZoom(newZoom)
      if (newZoom <= 1) setPan({ x: 0, y: 0 })
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
      if (zoom < 1.15) {
        setZoom(1)
        setPan({ x: 0, y: 0 })
      }
      return
    }
    if (type === 'pan') return
    if (!touchStartRef.current) return
    const step = mode === 'spread' ? (currentPage === 1 ? 1 : 2) : 1
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

  return { handleTouchStart, handleTouchMove, handleTouchEnd }
}
