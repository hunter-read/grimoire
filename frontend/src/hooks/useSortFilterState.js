import { useEffect, useRef } from 'react'
import useSessionState from './useSessionState'
import useRestoredView from './useRestoredView'

export const DEFAULT_SORT_FILTER = { sort: 'name', order: 'asc', filters: {} }

/**
 * The sort/filter state for a gallery, plus the "apply the saved default" rule.
 *
 * Split out of the views because the two halves have to agree, and getting that
 * wrong is what caused the back-button bug: the state lived in plain `useState`,
 * so leaving the page and returning remounted the view with the built-in
 * default, and the "apply the user's default preset" effect then fired again and
 * overwrote whatever the user had actually been looking at.
 *
 * The rule has two halves, and both matter:
 *
 *  * **Arriving fresh** — from anywhere else in the app, or a reload — applies
 *    the user's default preset. That is the whole point of setting a default,
 *    and it has to keep working every time, not just the first time in a
 *    session.
 *  * **Coming back** — the in-app back button from an item opened out of this
 *    view — restores exactly what the user was looking at, filters included.
 *
 * Which one applies is decided by `useRestoredView`: the back button navigates
 * with an explicit `restoreView` flag, and nothing else does. An earlier version
 * inferred it from "is anything in sessionStorage", which conflated the two —
 * once the user had touched the filters even once, *every* later visit counted
 * as a return and the default never came back for the rest of the session.
 *
 * `restore: false` keeps writing to storage on a fresh visit while ignoring what
 * is already there, so the state is still waiting to be read back if the user
 * later drills in and returns.
 *
 * @param {string} key    sessionStorage key, unique per scope
 * @param {object} saved  the useSavedFilters() result for this scope
 * @returns [sortFilter, setSortFilter]
 */
export default function useSortFilterState(key, saved) {
  const restoreView = useRestoredView()
  const [sortFilter, setSortFilter] = useSessionState(key, DEFAULT_SORT_FILTER, {
    restore: restoreView,
  })

  const applied = useRef(false)

  useEffect(() => {
    if (applied.current || !saved.loaded) return
    applied.current = true
    // A return trip already shows the user's own filtering — including the case
    // where they deliberately cleared the default away before drilling in.
    if (restoreView) return
    if (saved.defaultFilter?.state) setSortFilter(saved.defaultFilter.state)
    // setSortFilter is stable enough for this one-shot effect; re-running on its
    // identity would re-apply the default after the user changes something.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.loaded, saved.defaultFilter, restoreView])

  return [sortFilter, setSortFilter]
}
