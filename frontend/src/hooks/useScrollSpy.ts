import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import scrollParent from '../utils/scrollParent'

// How far below the scroller's top edge a section counts as "reached": past the
// sticky sort/filter bar that covers the top of every list.
export const SPY_OFFSET = 80

/**
 * The key of the run the reader has scrolled to inside `containerRef`.
 *
 * Each run starts at the element carrying `data-index-key` (its first row); the
 * current one is the last whose top has passed under the sticky toolbar, or the
 * first while the list's top is still in view. Read on scroll (one read per frame) from the
 * scroller the list actually sits in - the app scrolls `<main>`, not the page.
 *
 * `version` re-reads after the sections change without a scroll (a filter, a
 * folder opening above).
 */
export default function useScrollSpy(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  version: unknown = null
): string | null {
  const [current, setCurrent] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) return undefined
    const scroller = scrollParent(container)
    const target: HTMLElement | Window = scroller || window
    let frame = 0
    const read = () => {
      frame = 0
      const sections = container.querySelectorAll<HTMLElement>('[data-index-key]')
      if (!sections.length) return
      const top = (scroller ? scroller.getBoundingClientRect().top : 0) + SPY_OFFSET
      let key = sections[0].dataset.indexKey || null
      for (const section of sections) {
        if (section.getBoundingClientRect().top > top) break
        key = section.dataset.indexKey || key
      }
      setCurrent(key)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      target.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [containerRef, enabled, version])

  return enabled ? current : null
}
