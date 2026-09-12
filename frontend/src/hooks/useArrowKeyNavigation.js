import { useEffect, useRef } from 'react'

/**
 * Arrow-key prev/next navigation, skipped while focus is in a text field.
 *
 * Extracted from useImageGestures so detail views with nothing to zoom — audio
 * tracks and 3D models — get the same keys without taking on pinch, pan, and
 * swipe handling that does not apply to them. useImageGestures calls this for
 * its own keyboard half, so the two stay identical by construction.
 *
 * @param {Function} onNext  ArrowRight / ArrowDown
 * @param {Function} onPrev  ArrowLeft / ArrowUp
 */
export default function useArrowKeyNavigation(onNext, onPrev) {
  // Mutable refs so the listener is bound once but always sees the latest
  // callbacks, which change identity whenever the sibling index moves.
  const onNextRef = useRef(onNext)
  const onPrevRef = useRef(onPrev)
  useEffect(() => {
    onNextRef.current = onNext
  }, [onNext])
  useEffect(() => {
    onPrevRef.current = onPrev
  }, [onPrev])

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onNextRef.current?.()
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onPrevRef.current?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
