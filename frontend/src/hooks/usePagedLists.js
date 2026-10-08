import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// One page per request. Big enough that a folder of a few hundred items is one
// round trip, small enough that each response stays well under the server's
// latency budget on a large library (issue #221).
export const PAGE_SIZE = 200

// The first page of a list is smaller: a few screens' worth. Opening a category
// or a tag can open dozens of folders at once, each asking for its first page
// together, and on a single server worker those requests queue - small first
// pages kept that burst near 100ms where 200-item pages took ~450ms. Later
// pages, fetched one at a time as the user scrolls, use the full size.
export const FIRST_PAGE_SIZE = 60

const EMPTY_LIST = { items: [], total: null, loading: false, error: null }

/**
 * Several server-paged lists, keyed - one per open folder, or a single one for
 * a flat list (issue #221).
 *
 * The browse views no longer download a whole collection: each folder (or the
 * flat list) fetches its items a page at a time as it is opened and scrolled.
 * This owns that bookkeeping so the views only say *which* list they want.
 *
 * `fetchPage(key, offset, limit)` resolves `{ total, rows }`. Changing
 * `resetKey` (the filters and sort, serialised) drops every list, and any
 * response still in flight from before is ignored rather than appended to the
 * new results.
 *
 * Returns:
 *   get(key)        - `{ items, total, loading, error, hasMore }`, or undefined
 *                     before the list is first requested
 *   ensure(key)     - load the first page, if this list has not started
 *   loadMore(key)   - load the next page, if there is one and none is loading
 *   mapItems(fn)    - rewrite loaded items in place (after a local edit)
 *   lists           - every started list, by key
 */
export default function usePagedLists(
  fetchPage,
  resetKey,
  { pageSize = PAGE_SIZE, firstPageSize = Math.min(FIRST_PAGE_SIZE, pageSize) } = {}
) {
  const [lists, setLists] = useState({})
  const generation = useRef(0)
  const inFlight = useRef(new Set())
  // Read by the callbacks so they stay stable across renders.
  const current = useRef(lists)
  current.current = lists
  const fetcher = useRef(fetchPage)
  fetcher.current = fetchPage

  useEffect(() => {
    generation.current += 1
    inFlight.current = new Set()
    current.current = {}
    setLists({})
  }, [resetKey])

  const load = useCallback(
    (key) => {
      const gen = generation.current
      const flightKey = `${gen}\u0000${key}`
      if (inFlight.current.has(flightKey)) return
      const list = current.current[key] || EMPTY_LIST
      if (list.total !== null && list.items.length >= list.total) return
      inFlight.current.add(flightKey)
      const offset = list.items.length
      setLists((prev) => ({
        ...prev,
        [key]: { ...(prev[key] || EMPTY_LIST), loading: true, error: null },
      }))
      Promise.resolve(fetcher.current(key, offset, offset === 0 ? firstPageSize : pageSize))
        .then(({ total, rows }) => {
          if (gen !== generation.current) return
          setLists((prev) => {
            const before = prev[key] || EMPTY_LIST
            return {
              ...prev,
              [key]: { items: [...before.items, ...rows], total, loading: false, error: null },
            }
          })
        })
        .catch((error) => {
          if (gen !== generation.current) return
          setLists((prev) => ({
            ...prev,
            [key]: { ...(prev[key] || EMPTY_LIST), loading: false, error },
          }))
        })
        .finally(() => {
          inFlight.current.delete(flightKey)
        })
    },
    [pageSize, firstPageSize]
  )

  const ensure = useCallback(
    (key) => {
      if (!current.current[key]) load(key)
    },
    [load]
  )

  const loadMore = useCallback(
    (key) => {
      const list = current.current[key]
      if (!list || list.loading || list.error) return
      load(key)
    },
    [load]
  )

  const mapItems = useCallback((fn) => {
    setLists((prev) => {
      const next = {}
      for (const [key, list] of Object.entries(prev))
        next[key] = { ...list, items: list.items.map(fn) }
      return next
    })
  }, [])

  const get = useCallback(
    (key) => {
      const list = lists[key]
      if (!list) return undefined
      return { ...list, hasMore: list.total === null || list.items.length < list.total }
    },
    [lists]
  )

  return useMemo(
    () => ({ lists, get, ensure, loadMore, mapItems }),
    [lists, get, ensure, loadMore, mapItems]
  )
}
