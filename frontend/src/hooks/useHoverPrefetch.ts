import { useEffect, useRef, type PointerEvent } from 'react'
import { prefetchNow } from '../components/reader/pagePrefetch'

// How long the pointer must rest on a link before its page is loaded. Long
// enough that sweeping the cursor down a list of results doesn't render every
// page it crosses, and still well ahead of the click: a deliberate hover takes a
// few hundred milliseconds to become one.
export const HOVER_INTENT_MS = 80

/**
 * Event handlers that start loading a link's page images when the user shows
 * they are about to open it (issue #640). Spread them onto the link, or onto an
 * element wrapping it.
 *
 * - A mouse resting on it for HOVER_INTENT_MS, or keyboard focus held as long.
 * - A mouse button going down on it: the click follows on release.
 * - A finger lifting off it. Touch has no hover, and a touch that starts on a
 *   link may be the start of a scroll, so nothing loads until the tap is
 *   complete - which is still ahead of the reader asking for the page.
 *
 * `urls` is called when one of those happens, not on render, so it can be as
 * lazy as it likes and can return nothing while the data it needs is loading.
 */
export default function useHoverPrefetch(urls: () => string[]) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarm = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  const fire = () => {
    disarm()
    prefetchNow(urls())
  }
  const arm = () => {
    disarm()
    timer.current = setTimeout(fire, HOVER_INTENT_MS)
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )

  return {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== 'touch') arm()
    },
    onPointerLeave: disarm,
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== 'touch') fire()
    },
    onPointerUp: (e: PointerEvent) => {
      if (e.pointerType === 'touch') fire()
    },
    onPointerCancel: disarm,
    onFocus: arm,
    onBlur: disarm,
  }
}
