import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api'
import useSessionState from './useSessionState'

/**
 * The in-system search box on SystemDetailView.
 *
 * Extracted from that view so its ~900 lines are not also carrying the debounce
 * and the restore-on-back rule. Queries shorter than two characters clear the
 * results rather than search, so a single stray keystroke does not fire a
 * request per character.
 *
 * `restoreView` re-runs the query on mount, which is what makes a search
 * survive a trip into the reader and back; arriving at the system fresh starts
 * with an empty box.
 */
export default function useSystemSearch(systemId, restoreView) {
  const [searchQuery, setSearchQuery] = useSessionState(
    `grimoire:system:${systemId}:search-query`,
    '',
    { restore: restoreView }
  )
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef(null)

  const doSearch = useCallback(
    (q) => {
      if (q.length < 2) {
        setSearchResults(null)
        return
      }
      setSearching(true)
      api
        .get(`/search?q=${encodeURIComponent(q)}&system_id=${systemId}`)
        .then((r) => {
          setSearchResults(r)
          setSearching(false)
        })
        .catch(() => setSearching(false))
    },
    [systemId]
  )

  // Re-run the search on mount only when returning to the view (e.g. back from
  // the reader); a fresh navigation starts with an empty box.
  useEffect(() => {
    if (restoreView && searchQuery && searchQuery.length >= 2) doSearch(searchQuery)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchInput = (e) => {
    const v = e.target.value
    setSearchQuery(v)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(v), 350)
  }

  const clearSearch = () => {
    clearTimeout(searchTimer.current)
    setSearchQuery('')
    setSearchResults(null)
  }

  return {
    searchQuery,
    searchResults,
    searching,
    handleSearchInput,
    clearSearch,
  }
}
