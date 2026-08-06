import { useState, useMemo } from 'react'
import { bulk as bulkApi } from '../api'
import useBulkSelection from './useBulkSelection'

/**
 * Library-grid state for {@link LibraryView}: tag filtering plus bulk
 * selection/editing of game systems.
 *
 * Tag filtering is OR-based — a system matches if it carries *any* selected
 * tag — mirroring the media galleries (see `useMediaGallery`). Bulk tag apply
 * merges new tags into the whole selection via the single-request
 * `POST /systems/bulk/tags` endpoint, the same shape the media views use.
 *
 * @param {Array|null} systems - the loaded systems list (null while loading)
 * @param {Function} setSystems - state setter for the systems list, used to
 *   patch local copies after a save so the grid updates without a refetch
 */
export default function useSystemLibrary(systems, setSystems) {
  const bulk = useBulkSelection()
  const { selectedIds } = bulk
  const [selectedTags, setSelectedTags] = useState(new Set())
  const [applying, setApplying] = useState(false)

  // Every tag present across systems, lowercased and de-duped, for the filter.
  const allTags = useMemo(() => {
    if (!systems) return []
    return [
      ...new Set(systems.flatMap((s) => (s.tags || []).map((tag) => tag.toLowerCase()))),
    ].sort()
  }, [systems])

  const toggleTag = (tag) =>
    setSelectedTags((prev) => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })

  const clearTags = () => setSelectedTags(new Set())

  // OR match: keep systems carrying any selected tag (no filter selected → all).
  const matchesTags = (system) => {
    if (selectedTags.size === 0) return true
    const tagSet = new Set((system.tags || []).map((tag) => tag.toLowerCase()))
    return [...selectedTags].some((tag) => tagSet.has(tag))
  }

  const selectedSystems = systems ? systems.filter((s) => selectedIds.has(s.id)) : []

  // Merge `newTags` into every selected system in a single request. The old
  // one-PATCH-per-system fan-out raced on tag creation server-side (issue #270).
  const applyTags = async (newTags) => {
    if (!systems) return
    setApplying(true)
    try {
      const ids = [...selectedIds].filter((id) => systems.some((s) => s.id === id))
      if (!ids.length) return
      const { tags } = await bulkApi.addTags('system', ids, newTags)
      // The server returns each system's resulting tag list, so local state is
      // patched from what actually landed rather than a client-side guess.
      applyEdits(Object.fromEntries(ids.map((id) => [id, { tags: tags?.[id] || [] }])))
      bulk.clear()
    } finally {
      setApplying(false)
    }
  }

  // Patch local system copies after a bulk edit/tag apply so the grid reflects
  // the change without refetching.
  const applyEdits = (edited) =>
    setSystems((prev) =>
      prev ? prev.map((s) => (edited[s.id] ? { ...s, ...edited[s.id] } : s)) : prev
    )

  return {
    bulk,
    selectedTags,
    allTags,
    toggleTag,
    clearTags,
    matchesTags,
    selectedSystems,
    applying,
    applyTags,
    applyEdits,
  }
}
