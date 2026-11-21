import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'

// How long to keep trying to restore before giving up. Views fetch their data
// after mount, so the container is usually still empty (and unscrollable) on the
// first frame; we retry until the content is tall enough to honour the saved
// offset. Bounded so a view that legitimately got shorter doesn't retry forever.
const RESTORE_TIMEOUT_MS = 3000

const storageKey = (path: string) => `grimoire:scroll:${path}`

/**
 * Saves and restores the scroll position of a container element as the user
 * navigates between routes.
 *
 * Usage:
 *   const mainRef = useScrollRestoration()
 *   <main ref={mainRef} ...>
 *
 * Positions are stored in sessionStorage (keyed by pathname) so they survive
 * in-session navigation but reset on a full page reload.
 *
 * **Saving** happens as the user scrolls, under the path being scrolled - never
 * by reading `scrollTop` once a navigation has happened. By then the container
 * already holds the next view, and the browser has clamped its offset to fit
 * it: opening a book swaps in the full-height reader, so reading the offset
 * "on the way out" recorded 0 for the library, and going back landed at the
 * top (issue #947). Everything here runs in layout effects, whose cleanups run
 * during the commit - before the browser can fire the scroll event its clamp
 * causes - so that clamp is never written under the page being left.
 *
 * **Restoration** retries across animation frames until the incoming view has
 * rendered enough content to reach the saved offset (issue #257): applying
 * scrollTop while the view is still showing its loading spinner would clamp to
 * 0 and silently lose the position. The target is read before the new view can
 * scroll at all, and nothing is recorded while restoring, so the restore's own
 * writes - and the clamps it passes through - never replace it. Any scroll the
 * user performs themselves ends the retry loop, so restoration never fights a
 * deliberate scroll.
 */
export default function useScrollRestoration<
  E extends HTMLElement = HTMLElement,
>(): RefObject<E | null> {
  const ref = useRef<E | null>(null)
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined

    let target: number | null = null
    try {
      const saved = sessionStorage.getItem(storageKey(pathname))
      if (saved !== null) target = Number(saved)
    } catch {
      // Storage unavailable (private mode, quota): nothing to restore.
    }
    let restoring = target !== null && Number.isFinite(target) && target > 0

    // One write per frame at most, of the offset read when the event fired.
    let pending: number | null = null
    let writeFrame = 0
    const flush = () => {
      writeFrame = 0
      if (pending === null) return
      try {
        sessionStorage.setItem(storageKey(pathname), String(pending))
      } catch {
        // Losing a scroll position is harmless.
      }
      pending = null
    }
    const onScroll = () => {
      if (restoring) return
      pending = el.scrollTop
      if (!writeFrame) writeFrame = requestAnimationFrame(flush)
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    let frame = 0
    const deadline = Date.now() + RESTORE_TIMEOUT_MS

    // A scroll the user initiated means they've taken over — stop restoring.
    const onUserScroll = () => {
      restoring = false
    }

    const attempt = () => {
      if (!restoring) return
      // Applying the target is only meaningful once the content can reach it.
      // scrollTop silently clamps, so compare against what the element accepted.
      el.scrollTop = target!
      if (el.scrollTop >= target! || Date.now() > deadline) {
        restoring = false
        return
      }
      frame = requestAnimationFrame(attempt)
    }

    if (restoring) {
      // Let the incoming view render before the first attempt, and only listen
      // for user scrolls from that point — the restoring writes above fire
      // scroll events of their own, which must not be mistaken for a gesture.
      frame = requestAnimationFrame(() => {
        el.addEventListener('wheel', onUserScroll, { passive: true })
        el.addEventListener('touchmove', onUserScroll, { passive: true })
        attempt()
      })
    }

    return () => {
      restoring = false
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onUserScroll)
      el.removeEventListener('touchmove', onUserScroll)
      // The pending offset was read while this path was showing, so it is
      // still this path's to keep.
      cancelAnimationFrame(writeFrame)
      flush()
    }
  }, [pathname])

  return ref
}
