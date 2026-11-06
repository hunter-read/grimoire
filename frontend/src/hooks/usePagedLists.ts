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

export interface PagedList<T> {
  items: T[]
  total: number | null
  loading: boolean
  error: unknown
  /** Where `items` begins in the whole list: 0, unless it was opened part-way. */
  start?: number
}

export type FetchPage<T> = (
  key: string,
  offset: number,
  limit: number
) => Promise<{ total: number | null; rows: T[] }> | { total: number | null; rows: T[] }

/** A list as `get(key)` returns it. */
export interface PagedListView<T> extends PagedList<T> {
  hasMore: boolean
  /** Rows before `start` are not loaded (the list was opened part-way). */
  hasEarlier: boolean
}

export interface PagedLists<T> {
  /** Every started list, by key. */
  lists: Record<string, PagedList<T>>
  /** The list, or undefined before it is first requested. */
  get: (key: string) => PagedListView<T> | undefined
  /** Load the first page, if this list has not started. */
  ensure: (key: string) => void
  /** Load the next page, if there is one and none is loading. */
  loadMore: (key: string) => void
  /** Reopen the list at `offset`: drop what is loaded and load from there. */
  jumpTo: (key: string, offset: number) => void
  /** Load the page before `start`, when the list was opened part-way. */
  loadEarlier: (key: string) => void
  /** Rewrite loaded items in place (after a local edit). */
  mapItems: (fn: (item: T) => T) => void
  /** Drop loaded items matching `fn`, shrinking each list's total to match. */
  removeItems: (fn: (item: T) => boolean) => void
}

const EMPTY_LIST: PagedList<never> = { items: [], total: null, loading: false, error: null }

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
 *   removeItems(fn) - drop loaded items matching `fn` (after a local delete),
 *                     shrinking each list's total to match
 *   jumpTo(key, n)  - reopen the list at offset `n` (a jump rail landing deep in
 *                     a long list), without loading everything before it
 *   loadEarlier(key) - load the page before where a reopened list starts
 *   lists           - every started list, by key
 */
export default function usePagedLists<T>(
  fetchPage: FetchPage<T>,
  resetKey: unknown,
  {
    pageSize = PAGE_SIZE,
    firstPageSize = Math.min(FIRST_PAGE_SIZE, pageSize),
  }: { pageSize?: number; firstPageSize?: number } = {}
): PagedLists<T> {
  const [lists, setLists] = useState<Record<string, PagedList<T>>>({})
  const generation = useRef(0)
  // Bumped per list when it is reopened somewhere else, so a page still in
  // flight for its old position is dropped rather than appended.
  const epochs = useRef<Record<string, number>>({})
  const inFlight = useRef(new Set<string>())
  // Read by the callbacks so they stay stable across renders.
  const current = useRef(lists)
  current.current = lists
  const fetcher = useRef(fetchPage)
  fetcher.current = fetchPage

  useEffect(() => {
    generation.current += 1
    epochs.current = {}
    inFlight.current = new Set()
    current.current = {}
    setLists({})
  }, [resetKey])

  const load = useCallback(
    (key: string) => {
      const gen = generation.current
      const epoch = epochs.current[key] || 0
      const flightKey = `${gen}\u0000${epoch}\u0000${key}`
      if (inFlight.current.has(flightKey)) return
      const list = current.current[key] || EMPTY_LIST
      const start = list.start || 0
      if (list.total !== null && start + list.items.length >= list.total) return
      inFlight.current.add(flightKey)
      const offset = start + list.items.length
      setLists((prev) => ({
        ...prev,
        [key]: { ...(prev[key] || EMPTY_LIST), loading: true, error: null },
      }))
      Promise.resolve(fetcher.current(key, offset, offset === 0 ? firstPageSize : pageSize))
        .then(({ total, rows }) => {
          if (gen !== generation.current || epoch !== (epochs.current[key] || 0)) return
          setLists((prev) => {
            const before = prev[key] || EMPTY_LIST
            return {
              ...prev,
              [key]: {
                items: [...before.items, ...rows],
                total,
                loading: false,
                error: null,
                start: before.start || 0,
              },
            }
          })
        })
        .catch((error) => {
          if (gen !== generation.current || epoch !== (epochs.current[key] || 0)) return
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

  const jumpTo = useCallback(
    (key: string, offset: number) => {
      epochs.current[key] = (epochs.current[key] || 0) + 1
      const known = current.current[key]
      const reset: PagedList<T> = {
        items: [],
        total: known ? known.total : null,
        loading: false,
        error: null,
        start: Math.max(0, offset),
      }
      current.current = { ...current.current, [key]: reset }
      setLists((prev) => ({ ...prev, [key]: reset }))
      load(key)
    },
    [load]
  )

  const loadEarlier = useCallback(
    (key: string) => {
      const list = current.current[key]
      const start = list?.start || 0
      if (!list || list.loading || start === 0) return
      const gen = generation.current
      const epoch = epochs.current[key] || 0
      const from = Math.max(0, start - pageSize)
      setLists((prev) => ({ ...prev, [key]: { ...prev[key], loading: true, error: null } }))
      Promise.resolve(fetcher.current(key, from, start - from))
        .then(({ total, rows }) => {
          if (gen !== generation.current || epoch !== (epochs.current[key] || 0)) return
          setLists((prev) => {
            const before = prev[key] || EMPTY_LIST
            return {
              ...prev,
              [key]: {
                items: [...rows, ...before.items],
                total,
                loading: false,
                error: null,
                start: from,
              },
            }
          })
        })
        .catch((error) => {
          if (gen !== generation.current || epoch !== (epochs.current[key] || 0)) return
          setLists((prev) => ({ ...prev, [key]: { ...prev[key], loading: false, error } }))
        })
    },
    [pageSize]
  )

  const ensure = useCallback(
    (key: string) => {
      if (!current.current[key]) load(key)
    },
    [load]
  )

  const loadMore = useCallback(
    (key: string) => {
      const list = current.current[key]
      if (!list || list.loading || list.error) return
      load(key)
    },
    [load]
  )

  const mapItems = useCallback((fn: (item: T) => T) => {
    setLists((prev) => {
      const next: Record<string, PagedList<T>> = {}
      for (const [key, list] of Object.entries(prev))
        next[key] = { ...list, items: list.items.map(fn) }
      return next
    })
  }, [])

  // The server no longer has these rows, so the totals shrink with them: a
  // total left as it was would read as "more to load" and fetch a page that
  // starts one row past where it should.
  const removeItems = useCallback((fn: (item: T) => boolean) => {
    setLists((prev) => {
      const next: Record<string, PagedList<T>> = {}
      for (const [key, list] of Object.entries(prev)) {
        const items = list.items.filter((item) => !fn(item))
        const removed = list.items.length - items.length
        next[key] = {
          ...list,
          items,
          total: list.total === null ? null : Math.max(0, list.total - removed),
        }
      }
      return next
    })
  }, [])

  const get = useCallback(
    (key: string) => {
      const list = lists[key]
      if (!list) return undefined
      const start = list.start || 0
      return {
        ...list,
        start,
        hasMore: list.total === null || start + list.items.length < list.total,
        hasEarlier: start > 0,
      }
    },
    [lists]
  )

  return useMemo(
    () => ({ lists, get, ensure, loadMore, mapItems, removeItems, jumpTo, loadEarlier }),
    [lists, get, ensure, loadMore, mapItems, removeItems, jumpTo, loadEarlier]
  )
}
