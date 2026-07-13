import { useState, useEffect, useRef } from 'react'

/**
 * Defers rendering its children until the placeholder is near the viewport.
 * Once rendered, the measured height is remembered so collapsing/expanding
 * folders doesn't cause layout shifts on re-entry.
 *
 * Props:
 *   count     — number of items (used to estimate placeholder height before render)
 *   cardSize  — 'compact' | 'comfortable' (affects estimated card width)
 *   list      — when true, items stack one-per-row (affects height estimate)
 *   children  — the actual card grid to render when visible
 */
export default function LazyGrid({ count, cardSize, list, children }) {
  const [rendered, setRendered] = useState(false)
  const [measuredHeight, setMeasuredHeight] = useState(null)
  const placeholderRef = useRef(null)
  const contentRef = useRef(null)

  // Observe when the placeholder enters the viewport (+ 600px lookahead)
  useEffect(() => {
    if (rendered) return
    const el = placeholderRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setRendered(true)
      },
      { rootMargin: '600px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [rendered])

  // After the real grid renders, capture its height for the placeholder
  useEffect(() => {
    if (rendered && contentRef.current) {
      setMeasuredHeight(contentRef.current.offsetHeight)
    }
  }, [rendered])

  if (!rendered) {
    // List mode stacks one row per item (~60px tall incl. gap); grid mode
    // estimates from card width/height.
    let estimatedHeight
    if (measuredHeight != null) {
      estimatedHeight = measuredHeight
    } else if (list) {
      estimatedHeight = count * 60
    } else {
      const cardW = cardSize === 'compact' ? 156 : 216
      const cardH = cardSize === 'compact' ? 190 : 230
      // Subtract the surrounding chrome: sidebar + page padding on desktop, but
      // just page padding on mobile where the sidebar is a bottom bar (no width).
      const chrome = window.innerWidth < 768 ? 32 : 120
      const cols = Math.max(1, Math.floor((window.innerWidth - chrome) / cardW))
      const rows = Math.ceil(count / cols)
      estimatedHeight = rows * (cardH + 16)
    }
    return <div ref={placeholderRef} style={{ minHeight: estimatedHeight }} />
  }

  return <div ref={contentRef}>{children}</div>
}
