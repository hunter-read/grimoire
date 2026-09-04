import { useState, useEffect, useMemo, useRef } from 'react'
import api, { bulk as bulkApi } from '../api'
import useSessionState from './useSessionState'
import useViewMode from './useViewMode'
import useBulkSelection from './useBulkSelection'
import useSavedFilters from './useSavedFilters'
import useSortFilterState from './useSortFilterState'
import { useFavorites } from '../context/FavoritesContext'
// (getUserPrefs no longer needed — sort now comes from the shared sortFilter state)
import { getEffectiveTags, getTopFolder, getSubPath } from '../components/media/mediaConfig'
import { splitSpecial, isSpecialFilter } from '../components/library/specialFilters'

// Page size for the progressive load below. Large enough that a modest library
// arrives in one request, small enough that the first paint is quick on a big one.
const PAGE_SIZE = 500

// Stable empty array: a fresh `[]` per render would invalidate every useMemo
// that depends on `items` before the first page lands.
const EMPTY_ITEMS = []

/**
 * All shared data, filtering, grouping, and bulk-edit logic for a media gallery
 * (maps, tokens, audio). Driven by a `config` entry from mediaConfig.js so the
 * MapsView / TokensView / AudioView reduce to thin wrappers around the returned
 * state.
 *
 * Sort/filter flows through the shared SortFilterBar state (server-backed saved
 * presets, scope = config.collection). `filters` holds search/tags/favorites;
 * folder grouping is toggleable (flat list when off).
 */
export default function useMediaGallery(config) {
  const { type, collection, foldersUrl, listUrl, sessionKey } = config
  const { isFavorite } = useFavorites()

  const [data, setData] = useState(null)
  const [folderTags, setFolderTags] = useState({})
  const [grouped, setGrouped] = useSessionState(`${sessionKey}:grouped`, true)
  const [viewMode, cycleViewMode] = useViewMode(type)
  const [collapsed, setCollapsed] = useSessionState(sessionKey, new Set())
  const [editingFolder, setEditingFolder] = useState(null)
  const [bulkApplying, setBulkApplying] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadedCount, setLoadedCount] = useState(0)

  const savedFilters = useSavedFilters(collection)
  // Persisted for the session so returning from a detail view keeps the filters
  // the user had, rather than snapping back to their saved default.
  const [sortFilter, setSortFilter] = useSortFilterState(`${sessionKey}:sortFilter`, savedFilters)

  // Backward-compatible derived filter values from the unified state.
  const activeFilters = sortFilter.filters || {}
  const filter = activeFilters.search || ''
  const favOnly = activeFilters.favorites === true
  // Falls back to the shared empty array rather than a fresh `[]`: this feeds the
  // `filtered` memo's dependencies, and a new identity per render would rebuild
  // the whole filtered set on every render.
  const rawSelectedTags = activeFilters.tags || EMPTY_ITEMS
  // The inline tag chips only know about real tags — the special sentinels are
  // kept out of this set so they never render as a highlighted chip.
  const selectedTags = new Set(
    rawSelectedTags.filter((tg) => !isSpecialFilter(tg)).map((tg) => tg.toLowerCase())
  )
  const setFilter = (v) =>
    setSortFilter((s) => ({ ...s, filters: { ...s.filters, search: v || undefined } }))
  const toggleTag = (tag) =>
    setSortFilter((s) => {
      const cur = s.filters.tags || []
      const lower = tag.toLowerCase()
      const next = cur.some((tg) => tg.toLowerCase() === lower)
        ? cur.filter((tg) => tg.toLowerCase() !== lower)
        : [...cur, tag]
      return { ...s, filters: { ...s.filters, tags: next.length ? next : undefined } }
    })
  const clearTags = () =>
    setSortFilter((s) => ({ ...s, filters: { ...s.filters, tags: undefined } }))

  const bulk = useBulkSelection()
  const { selectedIds, selectedFolderPaths, count: totalSelected } = bulk

  // Items helper — `data` holds the collection under config.collection. The
  // empty fallback is a module-level constant rather than a fresh `[]`, so the
  // memoised derived data below is not invalidated on every pre-load render.
  const items = data ? data[collection] : EMPTY_ITEMS

  useEffect(() => {
    // Loading a library of thousands of items in one request meant the view sat
    // on a spinner until the last row arrived, and then parsed and laid out the
    // whole set at once. Fetching in pages and appending lets the first page
    // render almost immediately while the rest streams in behind it; filtering
    // and grouping stay client-side over the accumulated set, so search and
    // folder grouping still see the whole library once loading settles.
    let cancelled = false

    const loadPage = async (offset) => {
      const page = await api.get(`${listUrl}?limit=${PAGE_SIZE}&offset=${offset}`)
      if (cancelled) return
      const rows = page[collection] || []
      setData((prev) =>
        prev && offset > 0
          ? { ...page, [collection]: [...prev[collection], ...rows] }
          : { ...page, [collection]: rows }
      )
      setLoadedCount((prev) => (offset > 0 ? prev + rows.length : rows.length))
      // `total` is the server's count before pagination; stop when a short page
      // arrives too, so a mid-load change on the server cannot spin forever.
      const seen = offset + rows.length
      if (rows.length === PAGE_SIZE && seen < page.total) await loadPage(seen)
      else if (!cancelled) setLoadingMore(false)
    }

    api.get(foldersUrl).then((foldersData) => {
      if (cancelled) return
      const ft = {}
      for (const f of foldersData.folders) ft[f.path] = f.tags
      setFolderTags(ft)
    })

    setLoadingMore(true)
    loadPage(0).catch(() => {
      if (!cancelled) setLoadingMore(false)
    })

    return () => {
      cancelled = true
    }
    // Load once on mount; the config values are stable for a given view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Default the collapsed state (everything collapsed) once, after the first
  // page lands — deferring the whole grid's mount, which is what makes a large
  // library render at all quickly. Later pages must not re-collapse folders the
  // user has since opened, hence the one-shot ref.
  const openedFolders = useRef(new Set())
  const collapsedSeeded = useRef(false)
  useEffect(() => {
    if (collapsedSeeded.current || !data) return
    collapsedSeeded.current = true
    if (sessionStorage.getItem(sessionKey) !== null) return
    const keys = new Set()
    items.forEach((item) => {
      const folder = getTopFolder(item)
      const subPath = getSubPath(item)
      keys.add(folder)
      if (subPath) keys.add(`${folder}::${subPath}`)
    })
    setCollapsed(keys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Folders discovered in later pages start collapsed too, so a folder never
  // pops open mid-load and mounts hundreds of cards behind the user's back.
  useEffect(() => {
    if (!collapsedSeeded.current || !loadingMore) return
    setCollapsed((prev) => {
      let added = false
      const next = new Set(prev)
      for (const item of items) {
        const folder = getTopFolder(item)
        const subPath = getSubPath(item)
        if (!next.has(folder) && !openedFolders.current.has(folder)) {
          next.add(folder)
          added = true
        }
        const key = subPath ? `${folder}::${subPath}` : null
        if (key && !next.has(key) && !openedFolders.current.has(key)) {
          next.add(key)
          added = true
        }
      }
      return added ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loadingMore])

  const toggleCollapse = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        // Remember the user opened this one, so the auto-collapse of folders
        // arriving in later pages does not shut it again under them.
        openedFolders.current.add(key)
      } else {
        next.add(key)
        openedFolders.current.delete(key)
      }
      return next
    })

  const saveFolderTags = async (path, tags) => {
    await api.patch(foldersUrl, { path, tags })
    setFolderTags((prev) => ({ ...prev, [path]: tags }))
  }

  // Tag the whole selection in one request per kind (items, folders) rather than
  // one per item. The old fan-out raced on tag creation server-side and returned
  // intermittent 500s that left the button stuck on "Applying" (issue #270).
  const applyBulkTags = async (newTags) => {
    if (!newTags.length || totalSelected === 0 || bulkApplying) return
    setBulkApplying(true)
    try {
      const ids = [...selectedIds].filter((id) => items.some((i) => i.id === id))
      if (ids.length) await bulkApi.addTags(type, ids, newTags)

      const folders = [...selectedFolderPaths].map((path) => ({
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

      setData((prev) => ({
        ...prev,
        [collection]: prev[collection].map((item) =>
          selectedIds.has(item.id)
            ? { ...item, tags: [...new Set([...(item.tags || []), ...newTags])] }
            : item
        ),
      }))
      // Selection is deliberately kept so tags can be applied one at a time to
      // the same batch, and a typo can be corrected without re-picking every
      // item (issue #256). The bar's input clears itself instead.
    } finally {
      // Always released, so a failed apply re-enables the button instead of
      // leaving it stuck on "Applying" (issue #270).
      setBulkApplying(false)
    }
  }

  const selectedObjects = () => items.filter((i) => selectedIds.has(i.id))

  const applyEdits = (edited) =>
    setData((prev) => ({
      ...prev,
      [collection]: prev[collection].map((i) => (edited[i.id] ? { ...i, ...edited[i.id] } : i)),
    }))

  // ----- Derived view data (only meaningful once `data` has loaded) -----

  // On a large library (thousands of maps/tokens) the derived data below is the
  // dominant cost of every render, and it used to be rebuilt on all of them —
  // so a single keystroke in the search box re-split every item's path and
  // re-walked its folder ancestry. Each stage is memoised on exactly what it
  // reads, and the per-item values that never change with the filters (lowercased
  // search haystack, effective tags, folder segments) are computed once here and
  // reused by filtering, grouping, and the tag list.
  const decorated = useMemo(
    () =>
      items.map((item) => {
        const effective = getEffectiveTags(item, folderTags)
        const topFolder = getTopFolder(item)
        const subPath = getSubPath(item)
        return {
          item,
          topFolder,
          subPath,
          effective,
          effectiveLower: effective.map((t) => t.toLowerCase()),
          // NUL-joined: the separator must be something a search term can never
          // contain, or a query could match across two adjacent fields.
          haystack: [item.filename || '', topFolder, subPath, ...effective]
            .join('\0')
            .toLowerCase(),
        }
      }),
    [items, folderTags]
  )

  const allTags = useMemo(
    () => (data ? [...new Set(decorated.flatMap((d) => d.effectiveLower))].sort() : []),
    [data, decorated]
  )

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return decorated
      .filter((d) => {
        const textMatch = !filter || d.haystack.includes(q)
        const tagMatch =
          rawSelectedTags.length === 0 ||
          (() => {
            // An item's effective tags are its own plus those of every folder
            // above it, so the special "untagged"/"tagged" sentinels test that
            // combined set.
            const { values, pass } = splitSpecial(rawSelectedTags, d.effective)
            if (!pass) return false
            if (values.length === 0) return true
            const effectiveSet = new Set(d.effectiveLower)
            return values.some((tag) => effectiveSet.has(String(tag).toLowerCase()))
          })()
        const favMatch = !favOnly || isFavorite(type, d.item.id)
        return textMatch && tagMatch && favMatch
      })
      .map((d) => d.item)
  }, [decorated, filter, rawSelectedTags, favOnly, type, isFavorite])

  // Item comparator from the sort/order state. `name` sorts by filename; `size`
  // by file size (audio also supports `duration` and `title`).
  const { sort = 'name', order = 'asc' } = sortFilter
  const dir = order === 'desc' ? -1 : 1
  // A shared collator: String.prototype.localeCompare builds one per call, which
  // is the single most expensive part of sorting thousands of items.
  const collator = useMemo(() => new Intl.Collator(undefined, { numeric: true }), [])
  const sortItems = useMemo(() => {
    const itemCmp = {
      name: (a, b) => collator.compare(a.filename || '', b.filename || ''),
      title: (a, b) => collator.compare(a.title || a.filename || '', b.title || b.filename || ''),
      size: (a, b) => (a.file_size || 0) - (b.file_size || 0),
      duration: (a, b) => (a.duration || 0) - (b.duration || 0),
    }
    const cmp = itemCmp[sort] || itemCmp.name
    return (arr) => [...arr].sort((a, b) => dir * cmp(a, b))
  }, [sort, dir, collator])

  // Folders are ordered by name/order; items within a subfolder use the sort.
  const folderEntries = useMemo(() => {
    const byFolder = {}
    filtered.forEach((item) => {
      const folder = getTopFolder(item)
      const subPath = getSubPath(item)
      if (!byFolder[folder]) byFolder[folder] = {}
      if (!byFolder[folder][subPath]) byFolder[folder][subPath] = []
      byFolder[folder][subPath].push(item)
    })
    return Object.entries(byFolder)
      .map(([folder, subfolders]) => {
        const sortedSubs = {}
        for (const [sub, group] of Object.entries(subfolders)) sortedSubs[sub] = sortItems(group)
        return [folder, sortedSubs]
      })
      .sort(([a], [b]) => dir * collator.compare(a, b))
  }, [filtered, sortItems, dir, collator])

  // Flat sorted item list (used when folder grouping is turned off).
  const flatItems = useMemo(() => sortItems(filtered), [filtered, sortItems])

  // Subtitle counts. `totalCount` is every row the list endpoint returned for
  // this user (not data.total, which is the server's pre-pagination count and
  // can exceed what is actually on the page), so the "x of y" never advertises
  // items the user did not receive. `filteredCount` is what the filters leave.
  const totalCount = items.length
  const filteredCount = filtered.length
  // How much of the library has arrived so far, for callers that want to show
  // progress while the remaining pages stream in.
  const totalAvailable = data?.total ?? 0

  // Flat ordered list of visible ids, for shift-range selection. Matches the
  // on-screen order: grouped → by folder; flat → the single sorted list.
  const orderedIds = useMemo(
    () =>
      grouped
        ? folderEntries.flatMap(([, subfolders]) =>
            Object.values(subfolders).flatMap((group) => group.map((i) => i.id))
          )
        : flatItems.map((i) => i.id),
    [grouped, folderEntries, flatItems]
  )
  const toggleSelect = (id, mods = {}) => bulk.toggleItem(id, { ...mods, orderedIds })

  // Collapse/expand-all affordance state.
  const allKeys = useMemo(() => {
    const keys = new Set()
    folderEntries.forEach(([folder, subfolders]) => {
      keys.add(folder)
      Object.keys(subfolders)
        .filter((s) => s)
        .forEach((s) => keys.add(`${folder}::${s}`))
    })
    return keys
  }, [folderEntries])
  const noFolders = folderEntries.length === 0
  const allCollapsed = !noFolders && [...allKeys].every((k) => collapsed.has(k))
  const allExpanded = collapsed.size === 0

  const list = viewMode === 'list'
  const cardSize = viewMode === 'compact' ? 'compact' : 'comfortable'

  return {
    // raw + status
    data,
    folderTags,
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
    flatItems,
    // subtitle counts
    totalCount,
    filteredCount,
    totalAvailable,
    loadingMore,
    loadedCount,
    // collapse-all affordances
    allKeys,
    noFolders,
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
    toggleSelect,
  }
}
