import { useLayoutEffect, useRef, useState } from 'react'
import VirtualGridRows from './VirtualGridRows'

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
 * A windowed grid: only the rows near the viewport are mounted, and the rest of
 * the scroll height is held by a single sized spacer.
 *
 * This replaces mounting every card and keeping it (issue #467). A gallery of a
 * few thousand tokens held ~295k DOM nodes and gigabytes of heap; here the
 * mounted set is the visible rows plus an overscan either side, whatever the
 * collection's size.
 *
 * This component does one thing: find the scrolling ancestor, and only then
 * mount the rows. The virtualizer must not be created before its scroll element
 * is known (issue #531). It reads `initialOffset` on its first render, through
 * `calculateRange`, and caches the result:
 *
 *     this.scrollOffset = this.scrollOffset ?? initialOffset()
 *
 * Created too early, that caches 0. The virtualizer then re-applies the cached
 * 0 when it attaches, which is a literal `scrollTo({top: 0})` on the page —
 * expanding a folder mounts a grid, so every expand threw the gallery to the
 * top. Deferring the mount is what keeps the seed honest.
 *
 * The gate is on the lookup having *run*, not on it finding something: a page
 * whose document scrolls has no such ancestor and must still render its rows.
 *
 * Props:
 *   items      — the full ordered list
 *   renderItem — renders one item
 *   minColumn  — the grid's `gridMin` for the current card size, in px
 *   gap        — gutter between rows and columns, in px
 *   list       — one item per row (no tiling); `minColumn` is then unused
 */
export default function VirtualGrid(props) {
  const containerRef = useRef(null)
  // Wrapped so "resolved to nothing" is distinguishable from "not resolved yet".
  const [resolved, setResolved] = useState(null)

  // Read from the mounted DOM, not passed in, so a caller cannot wire it up
  // wrongly. On mount only: the app's scroll container does not change under a
  // mounted gallery.
  useLayoutEffect(() => {
    setResolved({ el: scrollParent(containerRef.current) })
  }, [])

  return (
    <div ref={containerRef}>
      {resolved && (
        <VirtualGridRows {...props} scrollEl={resolved.el} containerRef={containerRef} />
      )}
    </div>
  )
}
