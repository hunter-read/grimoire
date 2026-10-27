import { useEffect, useRef } from 'react'
import scrollParent from '../utils/scrollParent'

/**
 * Asks for the next page when the end of a list scrolls into view (issue #221).
 *
 * Paging is meant to be invisible: there is no "page 2", the list just keeps
 * going. This sits after the last loaded item and calls `onVisible` once it
 * comes within `rootMargin` of the scrolling container's edge, so the next page
 * is usually in hand before the user reaches the end.
 *
 * The observer is rebuilt whenever `count` changes. An IntersectionObserver
 * only reports *changes*, so a page too short to push the sentinel off screen
 * would otherwise never ask for the one after it; a fresh observer reports the
 * sentinel's current state straight away.
 *
 * Props:
 *   onVisible  - called when more should load
 *   active     - false once everything has loaded (or while a page is loading)
 *   count      - how many items are loaded; see above
 *   rootMargin - how far ahead of the edge to start loading
 */
export default function LoadMoreSentinel({
  onVisible,
  active = true,
  count = 0,
  rootMargin = '800px',
}) {
  const ref = useRef(null)
  const callback = useRef(onVisible)
  callback.current = onVisible

  useEffect(() => {
    const el = ref.current
    if (!active || !el || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) callback.current?.()
      },
      { root: scrollParent(el), rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [active, count, rootMargin])

  return <div ref={ref} data-testid="load-more" aria-hidden="true" style={{ height: 1 }} />
}
