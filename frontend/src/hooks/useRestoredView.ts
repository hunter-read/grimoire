import { useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * True when this mount is a *return* to the view (e.g. the reader's back button)
 * rather than a fresh navigation to it. Views use this to decide whether to
 * restore transient session state such as an in-system search query or an
 * unsaved sort/filter selection: coming back should feel like you never left,
 * but arriving fresh should always start clean.
 *
 * The flag is read once on mount and then stripped from history via a replace,
 * so a subsequent reload or forward-nav to the same URL counts as fresh.
 *
 * @returns {boolean} whether persisted view state should be restored
 */
export default function useRestoredView(): boolean {
  const location = useLocation()
  const navigate = useNavigate()
  // Captured on the first render so the value is stable for the whole mount,
  // including for state initialisers that run before the cleanup effect below.
  const state = location.state as Record<string, unknown> | null | undefined
  const restoreRef = useRef(state?.restoreView === true)

  useEffect(() => {
    if (!restoreRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the copy
    const { restoreView, ...rest } = state || {}
    navigate(location.pathname + location.search, {
      replace: true,
      state: Object.keys(rest).length ? rest : null,
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return restoreRef.current
}
