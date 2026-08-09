// Shared page-rendering constants and animation helper for the reader's page
// components (SinglePage / SpreadPage) and ReaderView's image preloader.

// Must match across visible images and preloader so browser cache hits.
export const PAGE_WIDTH = 1600
export const SPREAD_WIDTH = 1000

// Caps for the reader's in-memory page caches. The image cache is the one that
// matters: a decoded PAGE_WIDTH bitmap costs ~12MB of RAM regardless of how
// small the WebP payload was, so an unbounded cache reached multiple GB after a
// few hundred pages. The cap comfortably covers the largest prefetch window
// (±12 in spread mode) plus recent history, so scrolling back a few pages still
// hits the cache and the browser's own HTTP cache absorbs anything older.
export const PRELOAD_CACHE_MAX = 40
// Text/words entries are kilobytes each, but bounding them keeps a long reading
// session from growing without limit too.
export const TEXT_CACHE_MAX = 200

/**
 * Evict oldest entries from a plain-object cache held in a ref, keeping at most
 * `max`. Relies on JS objects preserving string-key insertion order; callers
 * must delete-then-reinsert if they want to mark an entry as recently used.
 */
export function pruneCache(cacheRef, max) {
  const keys = Object.keys(cacheRef.current)
  if (keys.length <= max) return
  for (const key of keys.slice(0, keys.length - max)) {
    delete cacheRef.current[key]
  }
}

/** Page-turn entrance animation + zoom/pan transform for a page container. */
export function animStyle(axisRef, directionRef, zoom, pan) {
  const axis = axisRef.current
  const dir = directionRef.current
  return {
    animation: `${
      axis === 'y'
        ? dir >= 0
          ? 'pageEnterBottom'
          : 'pageEnterTop'
        : dir >= 0
          ? 'pageEnterRight'
          : 'pageEnterLeft'
    } 0.25s cubic-bezier(0.22,1,0.36,1)`,
    transform: zoom !== 1 ? `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)` : undefined,
    transformOrigin: 'center center',
  }
}
