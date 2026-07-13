import { useState, useMemo } from 'react'
import api from '../api'
import useBulkSelection from './useBulkSelection'

/**
 * Library-grid state for {@link LibraryView}: tag filtering plus bulk
 * selection/editing of game systems.
 *
 * Tag filtering is OR-based — a system matches if it carries *any* selected
 * tag — mirroring the media galleries (see `useMediaGallery`). Bulk tag apply
 * merges new tags into each selected system's existing tags and persists them
 * via the per-system `PATCH /systems/{id}` endpoint, the same shape the media
 * views use.
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

  // Merge `newTags` into every selected system and persist each via PATCH.
  const applyTags = async (newTags) => {
    if (!systems) return
    setApplying(true)
    try {
      const edited = {}
      const requests = []
      for (const id of selectedIds) {
        const system = systems.find((s) => s.id === id)
        if (!system) continue
        const merged = [...new Set([...(system.tags || []), ...newTags])]
        edited[id] = { tags: merged }
        requests.push(api.patch(`/systems/${id}`, { tags: merged }))
      }
      await Promise.all(requests)
      applyEdits(edited)
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
