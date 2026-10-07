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
 * The windowed rows themselves. Split out from `VirtualGrid` because the
 * virtualizer must not exist before its scroll element does — see the note
 * there — and a component cannot create a hook conditionally.
 *
 * `scrollEl` is the resolved scrolling ancestor (or null when the document
 * scrolls), and `containerRef` is the wrapper `VirtualGrid` already owns.
 */
export default function VirtualGridRows({
  items,
  renderItem,
  minColumn,
  gap = 16,
  list = false,
  scrollEl,
  containerRef,
}) {
  const [width, setWidth] = useState(0)

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
    // containerRef is owned by VirtualGrid and stable for this component's
    // lifetime; listed so the rule can see that, not because it ever changes.
  }, [containerRef])

  const columns = list ? 1 : columnsFor(width, minColumn, gap)
  const rowCount = Math.ceil(items.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    // The virtualizer attaches to the scroll element on its first update and
    // immediately re-applies the offset it believes it is at. That offset
    // defaults to 0 and it has never observed a real one, so the re-apply is a
    // literal `scrollTo({top: 0})` on the page — which is what threw the
    // gallery to the top every time a folder was expanded, since expanding
    // mounts a grid. Seeding from the element's real position makes the
    // re-apply land where the page already is, i.e. a no-op.
    initialOffset: () => scrollEl?.scrollTop ?? 0,
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
  )
}
