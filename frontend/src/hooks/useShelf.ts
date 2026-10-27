import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import api, { type Schema } from '../api'
import usePagedLists, { type PagedLists } from './usePagedLists'
import { bookFilterParams, browseKey, withQuery, type BrowseFilters } from '../utils/browseParams'
import { buildShelf, splitNodeKey, type ShelfNode } from '../components/system/shelfTree'

export type ShelfSystem = Schema<'SystemDetail'>
export type ShelfBook = Schema<'BookOut'>
export type ShelfFacets = Schema<'ShelfFacetsResponse'>
export type ShelfGroups = Schema<'ShelfGroupsResponse'>

export interface Shelf {
  system: ShelfSystem | null
  setSystem: Dispatch<SetStateAction<ShelfSystem | null>>
  facets: ShelfFacets
  groups: ShelfGroups | null
  /** The category/subfolder tree, keyed by category. */
  shelf: Record<string, ShelfNode>
  pages: PagedLists<ShelfBook>
  /** Open a node's list, or page it further if already open. */
  loadNode: (key: string) => void
  /** Every book loaded so far, de-duplicated. */
  loadedBooks: ShelfBook[]
  updateBooks: (fn: (book: ShelfBook) => ShelfBook) => void
  reload: () => void
  flatBooks: ShelfBook[]
  flatHasMore: boolean
  flatLoading: boolean
  loadMoreFlat: () => void
  /** Matching books, or null until known. */
  matchCount: number | null
}

export interface ShelfOptions {
  grouped: boolean
  /** The shelf's SortFilterBar state. */
  bookFilter: { sort?: string; order?: string; filters?: BrowseFilters }
  /** Hold back every book fetch until true (default true). */
  ready?: boolean
}

// The list key for the ungrouped shelf; folder lists use shelfTree's nodeKey.
export const FLAT = '\u0000flat'

const EMPTY_FACETS: ShelfFacets = {
  categories: [],
  genres: [],
  product_code_prefixes: [],
  tags: [],
}

/**
 * Everything SystemDetailView shows about a system's books, fetched from the
 * server a piece at a time (issue #221).
 *
 * The view used to load the system with every one of its books and do the
 * rest in the browser. Now:
 *   - `system` is the summary alone (`include_books=false`);
 *   - `facets` are the filter menus' options, over the whole shelf;
 *   - `shelf` is the category/subfolder tree (shelfTree's buildShelf) from
 *     `/book-groups`, with counts - enough to draw the collapsed shelf;
 *   - `pages` holds the books, one paged list per open node (or one flat list),
 *     each fetched as it scrolls into view.
 *
 * Filters and sort come from the shelf's SortFilterBar state; changing either
 * refetches the tree and drops every loaded page. `reload()` does the same
 * after an edit that can move books between groups (a category change, a
 * variant promotion). Nothing about the books is fetched until `ready` - the
 * view holds it back until the user's default filter preset has been applied,
 * rather than loading the unfiltered shelf only to replace it.
 */
export default function useShelf(
  systemId: string | undefined,
  { grouped, bookFilter, ready = true }: ShelfOptions
): Shelf {
  const [system, setSystem] = useState<ShelfSystem | null>(null)
  const [facets, setFacets] = useState<ShelfFacets>(EMPTY_FACETS)
  const [groups, setGroups] = useState<ShelfGroups | null>(null)
  const [version, setVersion] = useState(0)

  const filters = bookFilter.filters || {}
  const { sort = 'title', order = 'asc' } = bookFilter
  const filterKey = browseKey(filters, sort, order)
  // Read by the fetchers so they use the filters in force when they run.
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  const reloadSystem = useCallback(
    () =>
      api
        .get(withQuery(`/systems/${systemId}`, { include_books: 'false' }))
        .then((s) => setSystem(s as ShelfSystem)),
    [systemId]
  )

  useEffect(() => {
    reloadSystem()
  }, [reloadSystem, version])

  useEffect(() => {
    let cancelled = false
    api
      .get(`/systems/${systemId}/book-facets`)
      .then((f) => !cancelled && setFacets({ ...EMPTY_FACETS, ...(f as Partial<ShelfFacets>) }))
      .catch(() => !cancelled && setFacets(EMPTY_FACETS))
    return () => {
      cancelled = true
    }
  }, [systemId, version])

  // The tree depends on the sort too: a folder's stand-in is its first book
  // under the active sort.
  useEffect(() => {
    if (!grouped || !ready) return undefined
    let cancelled = false
    const params = { ...bookFilterParams(filtersRef.current), sort, order }
    api
      .get(withQuery(`/systems/${systemId}/book-groups`, params))
      .then((raw) => {
        const body = raw as Partial<ShelfGroups> | null | undefined
        return !cancelled && setGroups({ total: body?.total ?? 0, groups: body?.groups || [] })
      })
      .catch(() => !cancelled && setGroups({ total: 0, groups: [] }))
    return () => {
      cancelled = true
    }
  }, [systemId, grouped, filterKey, sort, order, version, ready])

  const fetchPage = useCallback(
    (key: string, offset: number, limit: number) => {
      const params: Record<string, unknown> = {
        ...bookFilterParams(filtersRef.current),
        sort,
        order,
        limit,
        offset,
      }
      if (key !== FLAT) {
        const [category, folder] = splitNodeKey(key)
        params.category = category
        params.folder = folder
      }
      return api.get(withQuery(`/systems/${systemId}/books`, params)).then((raw) => {
        const page = raw as Partial<Schema<'SystemBooksPage'>> | null | undefined
        return { total: page?.total ?? 0, rows: page?.books || [] }
      })
    },
    [systemId, sort, order]
  )
  const pages = usePagedLists(fetchPage, `${systemId}|${filterKey}|${grouped}|${version}|${ready}`)
  const { ensure, loadMore, get: getList } = pages

  const loadNode = useCallback(
    (key: string) => (getList(key) ? loadMore(key) : ensure(key)),
    [getList, loadMore, ensure]
  )

  useEffect(() => {
    if (!grouped && ready) ensure(FLAT)
  }, [grouped, ready, ensure, pages.lists])

  const shelf = useMemo(() => buildShelf(groups?.groups || [], sort, order), [groups, sort, order])

  // Every book loaded so far, de-duplicated - what selection and edits act on.
  const loadedBooks = useMemo(() => {
    const seen = new Map<string, ShelfBook>()
    for (const list of Object.values(pages.lists)) {
      for (const book of list.items) if (!seen.has(book.id)) seen.set(book.id, book)
    }
    return [...seen.values()]
  }, [pages.lists])

  const reload = useCallback(() => setVersion((v) => v + 1), [])

  const flatList = getList(FLAT)
  // Matching books, for the subtitle and the empty state.
  const matchCount = grouped ? (groups?.total ?? null) : (flatList?.total ?? null)

  return {
    system,
    setSystem,
    facets,
    groups,
    shelf,
    pages,
    loadNode,
    loadedBooks,
    updateBooks: pages.mapItems,
    reload,
    flatBooks: flatList ? flatList.items : [],
    flatHasMore: flatList ? flatList.hasMore : false,
    flatLoading: flatList ? flatList.loading : false,
    loadMoreFlat: () => loadMore(FLAT),
    matchCount,
  }
}
