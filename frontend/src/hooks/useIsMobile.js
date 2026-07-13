import { useState, useEffect } from 'react'

// Default breakpoint mirrors AppShell's mobile threshold so the whole app agrees
// on what "mobile" means.
const DEFAULT_BREAKPOINT = 768

/**
 * Reactively track whether the viewport is below `breakpoint` (px).
 *
 * Unlike a one-off `window.matchMedia(...).matches` read at module load, this
 * subscribes to the media query and updates on resize / orientation change.
 */
export default function useIsMobile(breakpoint = DEFAULT_BREAKPOINT) {
  const query = `(max-width: ${breakpoint - 1}px)`

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e) => setIsMobile(e.matches)
    // Sync immediately in case the query changed between render and effect.
    setIsMobile(mql.matches)
    // Safari <14 only supports the deprecated add/removeListener API.
    if (mql.addEventListener) {
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }, [query])

  return isMobile
}
