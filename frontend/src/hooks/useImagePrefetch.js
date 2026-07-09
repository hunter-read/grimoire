import { useEffect, useRef } from 'react'

/**
 * Warm the browser image cache for the neighbours of the currently-viewed item
 * so prev/next navigation swaps in instantly instead of waiting on a fetch.
 *
 * Given the current index into a sibling list and a `urlFor(item)` builder,
 * prefetches in the order the user is most likely to go: next, prev, then the
 * second-next and second-previous. Each URL is fetched at most once for the life
 * of the hook (a persistent Image keeps the request from being garbage-collected
 * before it lands), so re-renders and revisits don't refetch.
 *
 * @param {Array} siblings   ordered list of neighbour items
 * @param {number} currentIndex index of the item currently shown (-1 if unknown)
 * @param {(item: any) => string} urlFor builds the full media URL for an item
 */
export default function useImagePrefetch(siblings, currentIndex, urlFor) {
  // Keep Image objects alive by URL so in-flight prefetches complete and we
  // never kick off the same request twice.
  const prefetched = useRef(new Map())

  useEffect(() => {
    if (currentIndex < 0 || !siblings || siblings.length === 0) return

    // Offsets in priority order: next, prev, 2nd-next, 2nd-prev.
    const offsets = [1, -1, 2, -2]
    for (const offset of offsets) {
      const idx = currentIndex + offset
      if (idx < 0 || idx >= siblings.length) continue
      const item = siblings[idx]
      if (!item) continue
      const url = urlFor(item)
      if (!url || prefetched.current.has(url)) continue
      const img = new Image()
      img.src = url
      prefetched.current.set(url, img)
    }
  }, [siblings, currentIndex, urlFor])
}
