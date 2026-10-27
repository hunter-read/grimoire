import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// How long to keep trying to restore before giving up. Views fetch their data
// after mount, so the container is usually still empty (and unscrollable) on the
// first frame; we retry until the content is tall enough to honour the saved
// offset. Bounded so a view that legitimately got shorter doesn't retry forever.
const RESTORE_TIMEOUT_MS = 3000

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
 * Restoration retries across animation frames until the incoming view has
 * rendered enough content to reach the saved offset (issue #257): applying
 * scrollTop while the view is still showing its loading spinner would clamp to
 * 0 and silently lose the position. Any scroll the user performs themselves
 * ends the retry loop, so restoration never fights a deliberate scroll.
 */
export default function useScrollRestoration() {
  const ref = useRef(null)
  const { pathname } = useLocation()
  const prevPathname = useRef(pathname)

  // Save scroll position whenever the pathname changes (i.e. we're navigating away).
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const leavingPath = prevPathname.current

    // Save the departing path's position before updating the ref.
    if (leavingPath !== pathname) {
      try {
        sessionStorage.setItem(`grimoire:scroll:${leavingPath}`, String(el.scrollTop))
      } catch {}
    }

    prevPathname.current = pathname

    let target = null
    try {
      const saved = sessionStorage.getItem(`grimoire:scroll:${pathname}`)
      if (saved !== null) target = Number(saved)
    } catch {}

    if (target === null || !Number.isFinite(target) || target <= 0) return

    let frame = 0
    let done = false
    const deadline = Date.now() + RESTORE_TIMEOUT_MS

    // A scroll the user initiated means they've taken over — stop restoring.
    const onUserScroll = () => {
      done = true
    }

    const attempt = () => {
      if (done) return
      // Applying the target is only meaningful once the content can reach it.
      // scrollTop silently clamps, so compare against what the element accepted.
      el.scrollTop = target
      if (el.scrollTop >= target || Date.now() > deadline) {
        done = true
        return
      }
      frame = requestAnimationFrame(attempt)
    }

    // Let the incoming view render before the first attempt, and only listen for
    // user scrolls from that point — the restoring writes above fire scroll
    // events of their own, which must not be mistaken for a user gesture.
    frame = requestAnimationFrame(() => {
      el.addEventListener('wheel', onUserScroll, { passive: true })
      el.addEventListener('touchmove', onUserScroll, { passive: true })
      attempt()
    })

    return () => {
      done = true
      cancelAnimationFrame(frame)
      el.removeEventListener('wheel', onUserScroll)
      el.removeEventListener('touchmove', onUserScroll)
    }
  }, [pathname])

  // Also save on unmount / page unload so the last position isn't lost.
  useEffect(() => {
    const el = ref.current
    const path = pathname
    return () => {
      if (!el) return
      try {
        sessionStorage.setItem(`grimoire:scroll:${path}`, String(el.scrollTop))
      } catch {}
    }
  }, [pathname])

  return ref
}
