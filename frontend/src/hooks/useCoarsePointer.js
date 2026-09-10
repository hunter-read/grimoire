import { useEffect, useState } from 'react'

// A touch screen reports a coarse primary pointer; a mouse or trackpad reports a
// fine one. This asks about the *input device*, which is the actual question
// when a gesture has to work — deliberately not viewport width, since an iPad in
// landscape is wide and touch-only while a small laptop window is narrow and has
// a mouse.
const QUERY = '(pointer: coarse)'

/**
 * Whether the primary pointing device is a finger rather than a mouse.
 *
 * Subscribed rather than read once, so a 2-in-1 folded from laptop to tablet
 * updates instead of keeping whatever it was at mount.
 */
export default function useCoarsePointer() {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia?.(QUERY)
    if (!mql) return
    const handler = (e) => setCoarse(e.matches)
    // Sync in case the answer changed between render and effect.
    setCoarse(mql.matches)
    // Safari <14 only has the deprecated add/removeListener API.
    if (mql.addEventListener) {
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }, [])

  return coarse
}
