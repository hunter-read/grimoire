import { useState, useEffect, useRef } from 'react'

/**
 * Defers rendering its children until the placeholder is near the viewport.
 * Once rendered, the measured height is remembered so collapsing/expanding
 * folders doesn't cause layout shifts on re-entry.
 *
 * Props:
 *   count     — number of items (used to estimate placeholder height before render)
 *   cardSize  — 'compact' | 'comfortable' (affects estimated card width)
 *   children  — the actual card grid to render when visible
 */
export default function LazyGrid({ count, cardSize, children }) {
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
    // Estimate: cards are ~(cardWidth + gap) wide, ~(190px + gap) tall
    const cardW = cardSize === 'compact' ? 156 : 216
    const cardH = cardSize === 'compact' ? 190 : 230
    const cols = Math.max(1, Math.floor((window.innerWidth - 120) / cardW))
    const rows = Math.ceil(count / cols)
    const estimatedHeight = measuredHeight ?? rows * (cardH + 16)
    return <div ref={placeholderRef} style={{ minHeight: estimatedHeight }} />
  }

  return <div ref={contentRef}>{children}</div>
}
