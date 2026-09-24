import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

// How many rows beyond the visible range to keep mounted on each side. Enough
// that normal scrolling never reaches an unrendered row, small enough that the
// mounted set stays a few screens rather than a whole collection.
const OVERSCAN = 3

// Rows are measured, but the virtualizer needs a starting guess before anything
// has been laid out. Only the first paint depends on it.
const ESTIMATED_ROW_HEIGHT = 240

/**
 * The nearest ancestor that actually scrolls, or null for the viewport.
 *
 * The app scrolls inside `<main>` rather than the document (see AppShell), so
 * the virtualizer has to watch that element: measuring against the window would
 * compare rows to a box that never scrolls.
 */
function scrollParent(el) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node
  }
  return null
}

/**
 * Column count for a `repeat(auto-fill, minmax(min, 1fr))` grid of `width`.
 *
 * Mirrors what the grid itself does: fit as many whole tracks of at least `min`
 * as there is room for, counting the gutters that sit *between* them.
 */
export function columnsFor(width, min, gap) {
  if (!width || !min) return 1
  return Math.max(1, Math.floor((width + gap) / (min + gap)))
}

/**
 * A windowed grid: only the rows near the viewport are mounted, and the rest of
 * the scroll height is held by a single sized spacer.
 *
 * This replaces mounting every card and keeping it (issue #467). A gallery of a
 * few thousand tokens held ~295k DOM nodes and gigabytes of heap; here the
 * mounted set is the visible rows plus OVERSCAN either side, whatever the
 * collection's size.
 *
 * Rows rather than blocks is what keeps the layout honest. Items are assigned to
 * rows by the same column count the grid lays out with, recomputed from the
 * container's own width, so a row is never partly rendered and no boundary can
 * fall mid-row. A resize changes the column count and the rows are simply
 * re-derived — there is no per-block reserved height to go stale.
 *
 * Row heights are measured rather than assumed, since a card's height depends on
 * the column width (square thumbnails) and on its own content (title wrapping).
 *
 * Props:
 *   items      — the full ordered list
 *   renderItem — (item) => node, called only for items in mounted rows
 *   minColumn  — the grid's `gridMin` for the current card size, in px
 *   gap        — gutter between rows and columns, in px
 *   list       — one item per row (no tiling); `minColumn` is then unused
 */
export default function VirtualGrid({ items, renderItem, minColumn, gap = 16, list = false }) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [scrollEl, setScrollEl] = useState(null)

  // The scrolling ancestor is found from the mounted DOM, not passed in, so a
  // caller cannot wire it up wrongly. Re-read on mount only: the app's scroll
  // container does not change under a mounted gallery.
  useLayoutEffect(() => {
    setScrollEl(scrollParent(containerRef.current))
  }, [])

  // Column count follows the container's width, not the window's: the gallery
  // sits inside a max-width column beside a collapsible sidebar, so the window
  // is not what decides how many cards fit.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const columns = list ? 1 : columnsFor(width, minColumn, gap)
  const rowCount = Math.ceil(items.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: OVERSCAN,
    // The grid is not at the top of the scroller — a header, toolbar and any
    // folders above it come first — so rows are offset by wherever the
    // container actually starts.
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  })

  // A column-count change moves every item to a different row, so the measured
  // heights no longer describe the rows they were taken from.
  useEffect(() => {
    virtualizer.measure()
  }, [columns, virtualizer])

  const rows = virtualizer.getVirtualItems()

  // Measured through the virtualizer's own ref so each row reports its real
  // height: cards with square thumbnails grow with the column width, and titles
  // wrap to a second line at some widths and not others.
  const measureRef = useCallback((node) => virtualizer.measureElement(node), [virtualizer])

  return (
    <div ref={containerRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {rows.map((row) => {
          const start = row.index * columns
          const rowItems = items.slice(start, start + columns)
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={measureRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                // Rows are positioned from the top of the scroller, so the
                // container's own offset within it comes back out here.
                transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
                display: list ? 'flex' : 'grid',
                flexDirection: list ? 'column' : undefined,
                // Explicit tracks, not auto-fill: every row must use the same
                // column count the row assignment above used, including the
                // last one, which would otherwise stretch its few cards across
                // the full width.
                gridTemplateColumns: list ? undefined : `repeat(${columns}, minmax(0, 1fr))`,
                gap,
                paddingBottom: gap,
                boxSizing: 'border-box',
              }}
            >
              {rowItems.map(renderItem)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
