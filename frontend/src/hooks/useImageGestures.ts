import { useState, useRef, useEffect, type CSSProperties, type RefObject } from 'react'
import useArrowKeyNavigation from './useArrowKeyNavigation'

export interface ImageGesturesOptions {
  onNext?: (() => void) | null
  onPrev?: (() => void) | null
  /** The scrollable image pane. */
  containerRef?: RefObject<HTMLElement | null> | null
  /** Changing this resets zoom and pan (pass the item id). */
  resetKey?: unknown
}

export interface ImageGestures {
  zoom: number
  imageStyle: CSSProperties
}

type Point = { x: number; y: number }

type Gesture =
  | { type: 'pinch'; initDist: number; initZoom: number }
  | { type: 'pan'; startX: number; startY: number; startPan: Point }
  | { type: 'swipe' }

/**
 * Pinch-to-zoom, pan-when-zoomed, swipe-to-navigate, and arrow-key navigation
 * for a full-screen image viewer (maps / tokens).
 *
 * @param {object}   opts
 * @param {Function} opts.onNext       - navigate to next item
 * @param {Function} opts.onPrev       - navigate to previous item
 * @param {object}   opts.containerRef - ref attached to the scrollable image pane
 * @param {string}   opts.resetKey     - changing this value resets zoom/pan (e.g. pass the item id)
 */
export default function useImageGestures({
  onNext,
  onPrev,
  containerRef,
  resetKey,
}: ImageGesturesOptions): ImageGestures {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  // Mutable refs so event-handler closures always see the latest values
  const zoomRef = useRef(1)
  const panRef = useRef<Point>({ x: 0, y: 0 })
  const gestureRef = useRef<Gesture | null>(null)
  const swipeStart = useRef<Point | null>(null)
  const onNextRef = useRef(onNext)
  const onPrevRef = useRef(onPrev)
  useEffect(() => {
    onNextRef.current = onNext
  }, [onNext])
  useEffect(() => {
    onPrevRef.current = onPrev
  }, [onPrev])

  // Reset zoom & pan when navigating to a new item
  useEffect(() => {
    setZoom(1)
    zoomRef.current = 1
    setPan({ x: 0, y: 0 })
    panRef.current = { x: 0, y: 0 }
    gestureRef.current = null
    swipeStart.current = null
  }, [resetKey])

  // Arrow-key navigation, shared with the detail views that have no image pane.
  useArrowKeyNavigation(onNext, onPrev)

  // Touch gestures — registered with { passive: false } so preventDefault works
  useEffect(() => {
    const el = containerRef?.current
    if (!el) return

    const dist = (t1: Touch, t2: Touch) => {
      const dx = t1.clientX - t2.clientX
      const dy = t1.clientY - t2.clientY
      return Math.sqrt(dx * dx + dy * dy)
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        gestureRef.current = {
          type: 'pinch',
          initDist: dist(e.touches[0], e.touches[1]),
          initZoom: zoomRef.current,
        }
        swipeStart.current = null
      } else if (e.touches.length === 1) {
        const t = e.touches[0]
        if (zoomRef.current > 1) {
          gestureRef.current = {
            type: 'pan',
            startX: t.clientX,
            startY: t.clientY,
            startPan: { ...panRef.current },
          }
        } else {
          gestureRef.current = { type: 'swipe' }
          swipeStart.current = { x: t.clientX, y: t.clientY }
        }
      }
    }

    const onMove = (e: TouchEvent) => {
      const g = gestureRef.current
      if (!g) return
      if (g.type === 'pinch' && e.touches.length === 2) {
        e.preventDefault()
        const newZoom = Math.max(
          1,
          Math.min(5, g.initZoom * (dist(e.touches[0], e.touches[1]) / g.initDist))
        )
        setZoom(newZoom)
        zoomRef.current = newZoom
        if (newZoom <= 1) {
          setPan({ x: 0, y: 0 })
          panRef.current = { x: 0, y: 0 }
        }
      } else if (g.type === 'pan' && e.touches.length === 1) {
        e.preventDefault()
        const z = zoomRef.current
        const newPan = {
          x: g.startPan.x + (e.touches[0].clientX - g.startX) / z,
          y: g.startPan.y + (e.touches[0].clientY - g.startY) / z,
        }
        setPan(newPan)
        panRef.current = newPan
      }
    }

    const onEnd = (e: TouchEvent) => {
      const g = gestureRef.current
      gestureRef.current = null
      if (g?.type === 'pinch') {
        if (zoomRef.current < 1.15) {
          setZoom(1)
          zoomRef.current = 1
          setPan({ x: 0, y: 0 })
          panRef.current = { x: 0, y: 0 }
        }
        return
      }
      if (g?.type === 'pan') return
      if (!swipeStart.current) return
      const t = e.changedTouches[0]
      const dx = t.clientX - swipeStart.current.x
      const dy = t.clientY - swipeStart.current.y
      swipeStart.current = null
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) onNextRef.current?.()
        else onPrevRef.current?.()
      }
    }

    el.addEventListener('touchstart', onStart, { passive: false })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
  }, [containerRef]) // containerRef is stable; onNext/onPrev accessed via refs

  const imageStyle: CSSProperties = {
    transform: zoom > 1 ? `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` : 'none',
    transformOrigin: 'center center',
    touchAction: zoom > 1 ? 'none' : 'pan-y',
    userSelect: 'none',
    willChange: 'transform',
  }

  return { zoom, imageStyle }
}
