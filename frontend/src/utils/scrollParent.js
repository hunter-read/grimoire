/**
 * The nearest ancestor that actually scrolls, or null for the viewport.
 *
 * The app scrolls inside `<main>` rather than the document (see AppShell), so
 * anything that watches scrolling - the virtualized grids, the load-more
 * sentinels - has to watch that element: measuring against the window would
 * compare rows to a box that never scrolls.
 */
export default function scrollParent(el) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node
  }
  return null
}
