import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import api, { bulk as bulkApi } from '../api'
import useSessionState from './useSessionState'
import useViewMode from './useViewMode'
import useBulkSelection from './useBulkSelection'
import useSavedFilters from './useSavedFilters'
import useSortFilterState, { DEFAULT_SORT_FILTER } from './useSortFilterState'
import usePagedLists from './usePagedLists'
import useTagLabels from './useTagLabels'
import { queryTags, toggleQueryTag } from '../components/library/tagQuery'
import { browseKey, commonFilterParams, withQuery } from '../utils/browseParams'

// The sort/filter state the SortFilterBar edits (see useSortFilterState).
type SortFilter = {
  sort?: string
  order?: 'asc' | 'desc'
  filters: Record<string, unknown> & { search?: string; tags?: unknown; favorites?: boolean }
}

// The list key for the ungrouped gallery; folder lists are keyed by their path.
export const FLAT = '\u0000flat'

// The top-level group items sitting directly in the collection folder belong to.
export const ROOT_FOLDER = '(Root)'

/** One gallery item as the list endpoints return it. */
export interface GalleryItem {
  id: string
  tags?: string[]
  [field: string]: unknown
}

/** The `mediaConfig.ts` fields the gallery reads. */
export interface GalleryConfig {
  type: 'map' | 'token' | 'audio' | 'model'
  collection: string
  foldersUrl: string
  listUrl: string
  sessionKey: string
  defaultSort?: string
}

/** The grouped view's folders, each with how many items it holds. */
interface Groups {
  total: number
  groups: { path: string; count: number }[]
}

/** One folder (or the folder's own items, under '') as MediaFolderGroup draws it. */
interface SubfolderEntry<T extends GalleryItem = GalleryItem> {
  path: string
  count: number
  items: T[]
  loading: boolean
  hasMore: boolean
  started: boolean
}

// Stable empty list, so memos depending on the flat items do not rebuild on
// every render before the first page lands.
const EMPTY_ITEMS: GalleryItem[] = []

// Largest page the server serves; used when a whole folder is needed at once
// (queuing a folder of audio to play).
const FULL_PAGE = 500

/**
 * A server folder path ("Pack/Sub/Deep") as the gallery's two-level grouping:
 * `[top folder, path below it]`, with items at the collection root under
 * `(Root)`. Mirrors getTopFolder/getSubPath in mediaConfig.ts.
 */
export function splitFolder(path: string | null | undefined): [string, string] {
  if (!path) return [ROOT_FOLDER, '']
  const cut = path.indexOf('/')
  return cut === -1 ? [path, ''] : [path.slice(0, cut), path.slice(cut + 1)]
}

/**
 * All shared data, filtering, grouping, and bulk-edit logic for a media gallery
 * (maps, tokens, audio, models). Driven by a `config` entry from mediaConfig.ts
 * so the views reduce to thin wrappers around the returned state.
 *
 * The server does the filtering, sorting and grouping (issue #221). Grouped,
 * the gallery draws its folders from `/groups` - each with a count - and a
 * folder fetches its items a page at a time as it is opened and scrolled into
 * view; ungrouped, one flat list pages in as the user scrolls. Nothing loads
 * the whole collection, so a library of a few hundred thousand tokens opens as
 * quickly as a small one.
 */
export default function useMediaGallery<T extends GalleryItem = GalleryItem>(
  config: GalleryConfig
) {
  const { type, collection, foldersUrl, listUrl, sessionKey } = config

  const [folderTags, setFolderTags] = useState<Record<string, string[]>>({})
  // Folder paths whose images are token-editor frames, from the same endpoint.
  // Only the token gallery ever gets a non-empty set; other collections have no
  // such concept and simply never see the field.
  const [frameFolders, setFrameFolders] = useState(() => new Set<string>())
  const [grouped, setGrouped] = useSessionState(`${sessionKey}:grouped`, true)
  const [viewMode, cycleViewMode] = useViewMode(type)
  const [collapsed, setCollapsed] = useSessionState(sessionKey, new Set<string>())
  const [editingFolder, setEditingFolder] = useState<string | null>(null)
  const [bulkApplying, setBulkApplying] = useState(false)
  // How many items the whole collection holds, unfiltered - the "y" of
  // "Displaying x of y".
  const [collectionTotal, setCollectionTotal] = useState<number | null>(null)
  const [groups, setGroups] = useState<Groups | null>(null)

  const savedFilters = useSavedFilters(collection)
  // Persisted for the session so returning from a detail view keeps the filters
  // the user had, rather than snapping back to their saved default.
  // A collection can open in its own order (audio: album order, issue #494).
  const [sortFilter, setSortFilter] = useSortFilterState<SortFilter>(
    `${sessionKey}:sortFilter`,
    savedFilters,
    (config.defaultSort
      ? { ...DEFAULT_SORT_FILTER, sort: config.defaultSort }
      : DEFAULT_SORT_FILTER) as SortFilter
  )

  const activeFilters = sortFilter.filters || {}
  const filter = activeFilters.search || ''
  const favOnly = activeFilters.favorites === true
  const { sort = config.defaultSort || 'name', order = 'asc' } = sortFilter
  // The inline tag chips only know about real tags — the group structure and
  // the special sentinels are flattened away so they never render as a chip.
  const selectedTags = new Set<string>(
    queryTags(activeFilters.tags).map((tg: string) => tg.toLowerCase())
  )
  const setFilter = (v: string) =>
    setSortFilter((s: SortFilter) => ({ ...s, filters: { ...s.filters, search: v || undefined } }))
  const toggleTag = (tag: string) =>
    setSortFilter((s: SortFilter) => {
      const next = toggleQueryTag(s.filters.tags, tag)
      return { ...s, filters: { ...s.filters, tags: next.length ? next : undefined } }
    })
  const clearTags = () =>
    setSortFilter((s: SortFilter) => ({ ...s, filters: { ...s.filters, tags: undefined } }))

  // What the server is asked for changes only with these; the folder counts do
  // not depend on the order, so they have their own key.
  const filterKey = browseKey(activeFilters)
  const listKey = `${browseKey(activeFilters, sort, order)}|${grouped}`

  // The filter options: every tag used on this collection (own or folder), with
  // its display casing.
  const tagLabels = useTagLabels(type)
  const allTags = useMemo(() => Object.keys(tagLabels).sort(), [tagLabels])

  const bulk = useBulkSelection()
  const { selectedIds, selectedFolderPaths, count: totalSelected } = bulk

  useEffect(() => {
    let cancelled = false
    api
      .get(foldersUrl)
      .then((body) => {
        if (cancelled) return
        const foldersData = body as {
          folders?: { path: string; tags: string[] }[]
          frame_folders?: string[]
        } | null
        const ft: Record<string, string[]> = {}
        for (const f of foldersData?.folders || []) ft[f.path] = f.tags
        setFolderTags(ft)
        setFrameFolders(new Set(foldersData?.frame_folders || []))
      })
      .catch(() => {})
    api
      .get(withQuery(listUrl, { limit: 1 }))
      .then((page) => !cancelled && setCollectionTotal((page as { total: number }).total))
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Load once on mount; the config values are stable for a given view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Read through a ref by the page fetcher, so it always uses the filters in
  // force when it runs without making the paged lists depend on them.
  const filtersRef = useRef(activeFilters)
  filtersRef.current = activeFilters

  const fetchPage = useCallback(
    (key: string, offset: number, limit: number) => {
      const params = {
        ...commonFilterParams(filtersRef.current),
        sort,
        order,
        limit,
        offset,
        ...(key === FLAT ? {} : { folder: key }),
      }
      return api.get(withQuery(listUrl, params)).then((body) => {
        const page = body as ({ total?: number } & Record<string, unknown>) | null
        return { total: page?.total ?? 0, rows: (page?.[collection] as T[]) || [] }
      })
    },
    [listUrl, collection, sort, order]
  )
  const pages = usePagedLists(fetchPage, listKey)

  // Every folder starts collapsed - including ones a new filter brings into
  // view - so opening the gallery, or widening a search, never fires a request
  // per folder. A returning visit keeps the open/closed state it left with.
  //
  // Applied in the same update that delivers the folders: done in an effect
  // afterwards, the first render drew every folder open, mounting each one's
  // loader and rescan control - over a thousand requests on a large library -
  // before collapsing them a moment later.
  const [hadStoredState] = useState(() => {
    try {
      return sessionStorage.getItem(sessionKey) !== null
    } catch {
      return false
    }
  })
  const seenFolders = useRef<Set<string> | null>(null)
  const applyGroups = useCallback(
    (body: Groups) => {
      const keys: string[] = []
      for (const g of body.groups) {
        const [folder, sub] = splitFolder(g.path)
        keys.push(folder)
        if (sub) keys.push(`${folder}::${sub}`)
      }
      if (seenFolders.current === null) {
        seenFolders.current = new Set(keys)
        if (!hadStoredState) setCollapsed(new Set(keys))
      } else {
        const seen = seenFolders.current
        const fresh = keys.filter((k) => !seen.has(k))
        fresh.forEach((k) => seen.add(k))
        if (fresh.length) setCollapsed((prev: Set<string>) => new Set([...prev, ...fresh]))
      }
      setGroups(body)
    },
    // setCollapsed is a session-state setter; the key it writes is fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hadStoredState]
  )

  // The folder structure, with counts, for the grouped view. The previous
  // result stays on screen while a new filter's arrives, so the gallery does
  // not blank between keystrokes.
  useEffect(() => {
    if (!grouped) return undefined
    let cancelled = false
    api
      .get(withQuery(`${listUrl}/groups`, commonFilterParams(filtersRef.current)))
      .then((res) => {
        const body = res as Partial<Groups> | null
        if (!cancelled) applyGroups({ total: body?.total ?? 0, groups: body?.groups || [] })
      })
      .catch(() => !cancelled && applyGroups({ total: 0, groups: [] }))
    return () => {
      cancelled = true
    }
  }, [grouped, filterKey, listUrl, applyGroups])

  const { ensure, loadMore, get: getList } = pages
  const loadFolder = useCallback(
    (key: string) => (getList(key) ? loadMore(key) : ensure(key)),
    [getList, loadMore, ensure]
  )

  // Ungrouped, the one flat list loads its first page straight away.
  useEffect(() => {
    if (!grouped) ensure(FLAT)
  }, [grouped, ensure, pages.lists])

  const toggleCollapse = (key: string) =>
    setCollapsed((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const saveFolderTags = async (path: string, tags: string[]) => {
    await api.patch(foldersUrl, { path, tags })
    setFolderTags((prev) => ({ ...prev, [path]: tags }))
  }

  // Every item loaded so far, across the open folders (or the flat list),
  // de-duplicated - what bulk selection and edits act on.
  const loadedItems = useMemo(() => {
    const seen = new Map<string, T>()
    const all = Object.values(pages.lists) as { items: T[] }[]
    for (const list of all) {
      for (const item of list.items) if (!seen.has(item.id)) seen.set(item.id, item)
    }
    return [...seen.values()]
  }, [pages.lists])

  // Tag the whole selection in one request per kind (items, folders) rather than
  // one per item. The old fan-out raced on tag creation server-side and returned
  // intermittent 500s that left the button stuck on "Applying" (issue #270).
  const applyBulkTags = async (newTags: string[]) => {
    if (!newTags.length || totalSelected === 0 || bulkApplying) return
    setBulkApplying(true)
    try {
      const ids: string[] = [...selectedIds]
      if (ids.length) await bulkApi.addTags(type, ids, newTags)

      const folders = [...(selectedFolderPaths as Set<string>)].map((path) => ({
        path,
        tags: [...new Set([...(folderTags[path] || []), ...newTags])],
      }))
      if (folders.length) {
        await bulkApi.setFolderTags(type, folders)
        setFolderTags((prev) => ({
          ...prev,
          ...Object.fromEntries(folders.map((f) => [f.path, f.tags])),
        }))
      }

      pages.mapItems((item: T) =>
        selectedIds.has(item.id)
          ? { ...item, tags: [...new Set([...(item.tags || []), ...newTags])] }
          : item
      )
      // Selection is deliberately kept so tags can be applied one at a time to
      // the same batch, and a typo can be corrected without re-picking every
      // item (issue #256). The bar's input clears itself instead.
    } finally {
      // Always released, so a failed apply re-enables the button instead of
      // leaving it stuck on "Applying" (issue #270).
      setBulkApplying(false)
    }
  }

  const selectedObjects = () => loadedItems.filter((i) => selectedIds.has(i.id))

  const applyEdits = (edited: Record<string, Partial<T>>) =>
    pages.mapItems((i: T) => (edited[i.id] ? { ...i, ...edited[i.id] } : i))

  // Drop items the server has deleted - the copies a merge folded into another
  // (issue #589) - from the loaded pages and from the selection.
  const removeItems = (ids: Iterable<string>) => {
    const gone = new Set(ids)
    pages.removeItems((i: T) => gone.has(i.id))
    bulk.setSelectedIds((prev: Set<string>) => new Set([...prev].filter((id) => !gone.has(id))))
  }

  // Every item of one folder, for actions that need them all at once (queuing
  // a folder of audio). Fetched in full pages with the gallery's filters and
  // order, independent of how much of the folder is on screen.
  const fetchFolderItems = useCallback(
    async (paths: string[]) => {
      const out: T[] = []
      for (const path of paths) {
        for (let offset = 0; ; offset += FULL_PAGE) {
          const params = {
            ...commonFilterParams(filtersRef.current),
            sort,
            order,
            folder: path,
            limit: FULL_PAGE,
            offset,
          }
          const page = (await api.get(withQuery(listUrl, params))) as {
            total: number
          } & Record<string, unknown>
          const rows = (page[collection] as T[]) || []
          out.push(...rows)
          if (rows.length < FULL_PAGE || out.length >= page.total) break
        }
      }
      return out
    },
    [listUrl, collection, sort, order]
  )

  // ----- Derived view data -----

  const dir = order === 'desc' ? -1 : 1
  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true }), [])

  // `[[folder, { sub: { path, count, items, total, loading, hasMore } }]]`, the
  // shape MediaFolderGroup renders: top-level folders in name order, each with
  // the folders below it that hold items ('' for its own items).
  const folderEntries = useMemo((): [string, Record<string, SubfolderEntry<T>>][] => {
    if (!groups) return []
    const byFolder: Record<string, Record<string, SubfolderEntry<T>>> = {}
    for (const g of groups.groups) {
      const [folder, sub] = splitFolder(g.path)
      const list = getList(g.path)
      if (!byFolder[folder]) byFolder[folder] = {}
      byFolder[folder][sub] = {
        path: g.path,
        count: g.count,
        items: list ? list.items : [],
        loading: list ? list.loading : false,
        hasMore: list ? list.hasMore : true,
        started: !!list,
      }
    }
    return Object.entries(byFolder).sort(([a], [b]) => dir * collator.compare(a, b))
  }, [groups, getList, dir, collator])

  const flatList = getList(FLAT)
  const flatItems = (pages.lists[FLAT]?.items as T[] | undefined) || (EMPTY_ITEMS as T[])

  // Subtitle counts: what the filters match, out of the whole collection.
  const filteredCount = grouped ? (groups?.total ?? 0) : (flatList?.total ?? 0)
  const totalCount = collectionTotal ?? filteredCount

  // Flat ordered list of visible ids, for shift-range selection. Matches the
  // on-screen order: grouped → by folder; flat → the single sorted list. Only
  // what has loaded can be in a range.
  const orderedIds = useMemo(
    () =>
      grouped
        ? folderEntries.flatMap(([, subfolders]): string[] =>
            Object.keys(subfolders)
              .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
              .flatMap((sub) => subfolders[sub].items.map((i) => i.id))
          )
        : flatItems.map((i) => i.id),
    [grouped, folderEntries, flatItems]
  )
  const toggleSelect = (id: string, mods: Record<string, unknown> = {}) =>
    bulk.toggleItem(id, { ...mods, orderedIds })

  // Collapse/expand-all affordance state.
  const allKeys = useMemo(() => {
    const keys = new Set<string>()
    folderEntries.forEach(([folder, subfolders]) => {
      keys.add(folder)
      Object.keys(subfolders)
        .filter((s) => s)
        .forEach((s) => keys.add(`${folder}::${s}`))
    })
    return keys
  }, [folderEntries])
  const noFolders = grouped ? groups !== null && folderEntries.length === 0 : false
  const noItems = grouped ? noFolders : flatList?.total === 0
  const allCollapsed = !noFolders && [...allKeys].every((k) => collapsed.has(k))
  const allExpanded = collapsed.size === 0

  const list = viewMode === 'list'
  const cardSize = viewMode === 'compact' ? 'compact' : 'comfortable'

  // Something to draw: the folder list, or the flat list's first page.
  const ready = grouped ? groups !== null : flatList?.total != null
  // Once drawn, the gallery stays drawn. A new search or filter swaps in a fresh
  // flat list whose first page is briefly not there yet; falling back to the
  // views' full-page spinner for that moment unmounted the whole layout, search
  // box included, so whatever was typed while it reloaded was lost - and under
  // React 19 that reload lands between keystrokes.
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    if (ready) setDrawn(true)
  }, [ready])
  const data = ready || drawn ? { total: filteredCount } : null

  return {
    // raw + status
    data,
    folderTags,
    frameFolders,
    // sort/filter state (shared SortFilterBar)
    sortFilter,
    setSortFilter,
    savedFilters,
    grouped,
    setGrouped,
    // backward-compatible derived filter values
    filter,
    setFilter,
    selectedTags,
    toggleTag,
    clearTags,
    favOnly,
    allTags,
    tagLabels,
    // view state
    viewMode,
    cycleViewMode,
    list,
    cardSize,
    collapsed,
    setCollapsed,
    toggleCollapse,
    editingFolder,
    setEditingFolder,
    saveFolderTags,
    // grouped + flat data
    folderEntries,
    loadFolder,
    fetchFolderItems,
    flatItems,
    flatHasMore: flatList ? flatList.hasMore : false,
    flatLoading: flatList ? flatList.loading : false,
    loadMoreFlat: () => loadMore(FLAT),
    // subtitle counts
    totalCount,
    filteredCount,
    // Kept for the views' subtitle: nothing streams in the background any more.
    totalAvailable: totalCount,
    loadingMore: false,
    // collapse-all affordances
    allKeys,
    noFolders,
    noItems,
    allCollapsed,
    allExpanded,
    // bulk
    bulk,
    selectedIds,
    selectedFolderPaths,
    totalSelected,
    bulkApplying,
    applyBulkTags,
    selectedObjects,
    applyEdits,
    removeItems,
    toggleSelect,
  }
}
