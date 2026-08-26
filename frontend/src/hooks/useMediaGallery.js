import { useState, useEffect } from 'react'
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

  const savedFilters = useSavedFilters(collection)
  // Persisted for the session so returning from a detail view keeps the filters
  // the user had, rather than snapping back to their saved default.
  const [sortFilter, setSortFilter] = useSortFilterState(`${sessionKey}:sortFilter`, savedFilters)

  // Backward-compatible derived filter values from the unified state.
  const activeFilters = sortFilter.filters || {}
  const filter = activeFilters.search || ''
  const favOnly = activeFilters.favorites === true
  const rawSelectedTags = activeFilters.tags || []
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

  // Items helper — `data` holds the collection under config.collection.
  const items = data ? data[collection] : []

  useEffect(() => {
    Promise.all([api.get(listUrl), api.get(foldersUrl)]).then(([listData, foldersData]) => {
      setData(listData)
      const ft = {}
      for (const f of foldersData.folders) ft[f.path] = f.tags
      setFolderTags(ft)
      // Only set the default collapsed state (all collapsed) when no saved state exists.
      const hasSaved = sessionStorage.getItem(sessionKey) !== null
      if (!hasSaved) {
        const keys = new Set()
        listData[collection].forEach((item) => {
          const folder = getTopFolder(item)
          const subPath = getSubPath(item)
          keys.add(folder)
          if (subPath) keys.add(`${folder}::${subPath}`)
        })
        setCollapsed(keys)
      }
    })
    // Load once on mount; the config values are stable for a given view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleCollapse = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
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

  const allTags = data
    ? [
        ...new Set(
          items.flatMap((item) => getEffectiveTags(item, folderTags).map((t) => t.toLowerCase()))
        ),
      ].sort()
    : []

  const filtered = items.filter((item) => {
    const q = filter.toLowerCase()
    const textMatch =
      !filter ||
      item.filename.toLowerCase().includes(q) ||
      getTopFolder(item).toLowerCase().includes(q) ||
      getSubPath(item).toLowerCase().includes(q) ||
      getEffectiveTags(item, folderTags).some((tag) => tag.toLowerCase().includes(q))
    const tagMatch =
      rawSelectedTags.length === 0 ||
      (() => {
        // An item's effective tags are its own plus those of every folder
        // above it, so the special "untagged"/"tagged" sentinels test that
        // combined set.
        const effective = getEffectiveTags(item, folderTags)
        const { values, pass } = splitSpecial(rawSelectedTags, effective)
        if (!pass) return false
        if (values.length === 0) return true
        const effectiveSet = new Set(effective.map((t) => t.toLowerCase()))
        return values.some((tag) => effectiveSet.has(String(tag).toLowerCase()))
      })()
    const favMatch = !favOnly || isFavorite(type, item.id)
    return textMatch && tagMatch && favMatch
  })

  // Item comparator from the sort/order state. `name` sorts by filename; `size`
  // by file size (audio also supports `duration` and `title`).
  const { sort = 'name', order = 'asc' } = sortFilter
  const dir = order === 'desc' ? -1 : 1
  const itemCmp = {
    name: (a, b) => (a.filename || '').localeCompare(b.filename || ''),
    title: (a, b) => (a.title || a.filename || '').localeCompare(b.title || b.filename || ''),
    size: (a, b) => (a.file_size || 0) - (b.file_size || 0),
    duration: (a, b) => (a.duration || 0) - (b.duration || 0),
  }
  const sortItems = (arr) => [...arr].sort((a, b) => dir * (itemCmp[sort] || itemCmp.name)(a, b))

  const byFolder = {}
  filtered.forEach((item) => {
    const folder = getTopFolder(item)
    const subPath = getSubPath(item)
    if (!byFolder[folder]) byFolder[folder] = {}
    if (!byFolder[folder][subPath]) byFolder[folder][subPath] = []
    byFolder[folder][subPath].push(item)
  })

  // Folders are ordered by name/order; items within a subfolder use the sort.
  const folderEntries = Object.entries(byFolder)
    .map(([folder, subfolders]) => {
      const sortedSubs = {}
      for (const [sub, group] of Object.entries(subfolders)) sortedSubs[sub] = sortItems(group)
      return [folder, sortedSubs]
    })
    .sort(([a], [b]) => dir * a.localeCompare(b))

  // Flat sorted item list (used when folder grouping is turned off).
  const flatItems = sortItems(filtered)

  // Subtitle counts. `totalCount` is every row the list endpoint returned for
  // this user (not data.total, which is the server's pre-pagination count and
  // can exceed what is actually on the page), so the "x of y" never advertises
  // items the user did not receive. `filteredCount` is what the filters leave.
  const totalCount = items.length
  const filteredCount = filtered.length

  // Flat ordered list of visible ids, for shift-range selection. Matches the
  // on-screen order: grouped → by folder; flat → the single sorted list.
  const orderedIds = grouped
    ? folderEntries.flatMap(([, subfolders]) =>
        Object.values(subfolders).flatMap((group) => group.map((i) => i.id))
      )
    : flatItems.map((i) => i.id)
  const toggleSelect = (id, mods = {}) => bulk.toggleItem(id, { ...mods, orderedIds })

  // Collapse/expand-all affordance state.
  const allKeys = new Set()
  folderEntries.forEach(([folder, subfolders]) => {
    allKeys.add(folder)
    Object.keys(subfolders)
      .filter((s) => s)
      .forEach((s) => allKeys.add(`${folder}::${s}`))
  })
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
