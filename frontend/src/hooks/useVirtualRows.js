import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Window a long, uniform-height list down to the rows actually on screen.
 *
 * The file tree can legitimately hold six figures of rows — a library with
 * 100,000 files, several large folders expanded at once — and React's cost here
 * is linear in *rendered* nodes, not in data. Rendering the whole list would
 * create tens of thousands of DOM nodes with drag handlers attached, which
 * stalls the main thread on expand and makes scrolling janky long before the
 * data itself is a problem.
 *
 * Every row in this tree is the same height, so the visible slice is arithmetic
 * rather than measurement: no ResizeObserver, no per-row height cache, no
 * dependency. Spacer divs above and below preserve the scrollbar geometry so
 * scrolling feels native and the scroll position stays honest.
 *
 * `overscan` rows are kept beyond each edge so fast scrolling doesn't flash
 * blank space, and so a drag hovering just past the edge still finds a row.
 */
export function useVirtualRows({ count, rowHeight, overscan = 8 }) {
  const scrollRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  // Measure the viewport, and keep measuring: the pane is flex-sized, so it
  // changes with the window and when the other pane's content reflows.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewportHeight(el.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback((e) => setScrollTop(e.currentTarget.scrollTop), [])

  const range = useMemo(() => {
    // Before the first measurement, render a modest slice rather than nothing:
    // an unmeasured pane that renders zero rows looks like a failed load, and
    // tests that never lay out would see an empty tree.
    const height = viewportHeight || 400
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    const visible = Math.ceil(height / rowHeight) + overscan * 2
    const last = Math.min(count, first + visible)
    return { first, last }
  }, [scrollTop, viewportHeight, rowHeight, count, overscan])

  // Clamp the scroll position when the list shrinks under it (collapsing a big
  // folder), so the view doesn't strand itself past the new end.
  //
  // Only ever *reduces* scrollTop, and only when the content genuinely no longer
  // extends that far — so it corrects a stranded view without fighting the drag
  // auto-scroll, which nudges scrollTop on a timer.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const max = Math.max(0, count * rowHeight - el.clientHeight)
    if (el.scrollTop > max) {
      el.scrollTop = max
      setScrollTop(max)
    }
  }, [count, rowHeight])

  return {
    scrollRef,
    onScroll,
    first: range.first,
    last: range.last,
    padTop: range.first * rowHeight,
    padBottom: Math.max(0, (count - range.last) * rowHeight),
  }
}

export default useVirtualRows
