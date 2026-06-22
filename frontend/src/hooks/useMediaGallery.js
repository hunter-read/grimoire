import { useState, useEffect } from 'react'
import api from '../api'
import useSessionState from './useSessionState'
import useViewMode from './useViewMode'
import useBulkSelection from './useBulkSelection'
import { getUserPrefs } from './useUserPrefs'
import { useFavorites } from '../context/FavoritesContext'
import { getFolderPath, getTopFolder, getSubPath } from '../components/media/mediaConfig'

/**
 * All shared data, filtering, grouping, and bulk-edit logic for a media gallery
 * (maps, tokens, …). Driven by a `config` entry from mediaConfig.js so the
 * MapsView and TokensView reduce to thin wrappers around the returned state.
 */
export default function useMediaGallery(config) {
  const { type, collection, foldersUrl, listUrl, itemUrl, sessionKey } = config
  const { isFavorite } = useFavorites()

  const [data, setData] = useState(null)
  const [folderTags, setFolderTags] = useState({})
  const [filter, setFilter] = useState('')
  const [selectedTags, setSelectedTags] = useState(new Set())
  const [favOnly, setFavOnly] = useState(false)
  const [viewMode, cycleViewMode] = useViewMode(type)
  const [collapsed, setCollapsed] = useSessionState(sessionKey, new Set())
  const [editingFolder, setEditingFolder] = useState(null)
  const [bulkApplying, setBulkApplying] = useState(false)

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

  const toggleTag = (tag) =>
    setSelectedTags((prev) => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })

  const applyBulkTags = async (newTags) => {
    if (!newTags.length || totalSelected === 0 || bulkApplying) return
    setBulkApplying(true)
    const promises = []

    for (const id of selectedIds) {
      const item = items.find((i) => i.id === id)
      if (!item) continue
      const merged = [...new Set([...(item.tags || []), ...newTags])]
      promises.push(api.patch(itemUrl(id), { tags: merged }))
    }

    for (const path of selectedFolderPaths) {
      const existing = folderTags[path] || []
      const merged = [...new Set([...existing, ...newTags])]
      promises.push(
        api
          .patch(foldersUrl, { path, tags: merged })
          .then(() => setFolderTags((prev) => ({ ...prev, [path]: merged })))
      )
    }

    await Promise.all(promises)

    setData((prev) => ({
      ...prev,
      [collection]: prev[collection].map((item) =>
        selectedIds.has(item.id)
          ? { ...item, tags: [...new Set([...(item.tags || []), ...newTags])] }
          : item
      ),
    }))

    bulk.clear()
    setBulkApplying(false)
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
          items.flatMap((item) =>
            [...(item.tags || []), ...(folderTags[getFolderPath(item)] || [])].map((t) =>
              t.toLowerCase()
            )
          )
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
      (item.tags || []).some((tag) => tag.toLowerCase().includes(q)) ||
      (folderTags[getFolderPath(item)] || []).some((tag) => tag.toLowerCase().includes(q))
    const tagMatch =
      selectedTags.size === 0 ||
      (() => {
        const itemTagSet = new Set((item.tags || []).map((t) => t.toLowerCase()))
        const folderTagSet = new Set(
          (folderTags[getFolderPath(item)] || []).map((t) => t.toLowerCase())
        )
        return [...selectedTags].some((tag) => itemTagSet.has(tag) || folderTagSet.has(tag))
      })()
    const favMatch = !favOnly || isFavorite(type, item.id)
    return textMatch && tagMatch && favMatch
  })

  const byFolder = {}
  filtered.forEach((item) => {
    const folder = getTopFolder(item)
    const subPath = getSubPath(item)
    if (!byFolder[folder]) byFolder[folder] = {}
    if (!byFolder[folder][subPath]) byFolder[folder][subPath] = []
    byFolder[folder][subPath].push(item)
  })

  const prefs = getUserPrefs()
  const sort = prefs.librarySort || 'az'
  const folderEntries = Object.entries(byFolder).sort(([a], [b]) =>
    sort === 'za' ? b.localeCompare(a) : a.localeCompare(b)
  )

  // Flat ordered list of visible ids, for shift-range selection.
  const orderedIds = folderEntries.flatMap(([, subfolders]) =>
    Object.values(subfolders).flatMap((group) => group.map((i) => i.id))
  )
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
    // filter state
    filter,
    setFilter,
    selectedTags,
    toggleTag,
    clearTags: () => setSelectedTags(new Set()),
    favOnly,
    setFavOnly,
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
    // grouped data
    folderEntries,
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
