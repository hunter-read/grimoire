import { useState, useLayoutEffect } from 'react'

// Space left below the element so it stops short of the window edge instead of
// running flush against it (matches the surrounding views' 24px padding).
const BOTTOM_GAP = 24

/**
 * Height that makes `ref`'s element reach the bottom of the viewport.
 *
 * The wiki editor is mounted at different depths (the full-page notes view, the
 * campaign detail tab) and its distance from the top changes as headers show
 * and hide, so the offset is measured from the live element rather than
 * hardcoded per host. Returns `null` until measured, and whenever the available
 * space is below `min` — callers then fall back to natural content height, so a
 * short window scrolls the page normally instead of squashing the editor.
 *
 * `ready` guards the first measurement: a caller that renders a placeholder
 * (spinner, empty state) before the real element exists passes `false` until
 * the ref is populated, so the measurement isn't taken — and missed — while the
 * ref is still empty.
 */
export default function useFillViewport(ref, { min = 320, enabled = true, ready = true } = {}) {
  const [height, setHeight] = useState(null)

  useLayoutEffect(() => {
    if (!enabled || !ready) {
      setHeight(null)
      return
    }
    const measure = () => {
      const el = ref.current
      if (!el) return
      // Measure against the element's own top edge. Reading it while a height is
      // already applied is safe: the top doesn't depend on our own height, since
      // the element is laid out top-down from content above it.
      const top = el.getBoundingClientRect().top
      const avail = window.innerHeight - top - BOTTOM_GAP
      const next = avail >= min ? avail : null
      // Keep the identical value so an observer firing on our own resize (we
      // observe the element we size) can't loop or land a stray re-render on
      // top of the editor's caret bookkeeping.
      setHeight((prev) => (prev === next ? prev : next))
    }
    measure()
    window.addEventListener('resize', measure)
    // Content above the editor (a wrapping toolbar, a header that hides on
    // mobile) can reflow without a resize event, which moves our top edge.
    // Only the document is observed, never the element we size — watching our
    // own target would feed each height we set straight back in as a resize.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(document.documentElement)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [ref, min, enabled, ready])

  return height
}
