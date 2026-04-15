import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

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
 * Restoration is deferred one frame to let the incoming view finish its initial
 * render before scrollTop is applied.
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

    const save = () => {
      try {
        sessionStorage.setItem(`grimoire:scroll:${leavingPath}`, String(el.scrollTop))
      } catch {}
    }

    // Save the departing path's position before updating the ref.
    if (leavingPath !== pathname) {
      save()
    }

    prevPathname.current = pathname

    // Restore position for the new pathname after the view renders.
    const frame = requestAnimationFrame(() => {
      try {
        const saved = sessionStorage.getItem(`grimoire:scroll:${pathname}`)
        if (saved !== null && el) {
          el.scrollTop = Number(saved)
        }
      } catch {}
    })

    return () => cancelAnimationFrame(frame)
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
