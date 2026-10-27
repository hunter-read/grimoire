import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Shared bulk-selection state for the library views (maps, tokens, books).
 *
 * Tracks selected item ids and selected folder paths, plus a "bulk mode" flag
 * that toggles the checkboxes and the bottom action bar. Item toggling supports
 * shift-click range selection and cmd/ctrl-click additive toggling against a
 * caller-supplied flat list of the currently visible ids (in display order).
 *
 * Folder toggling selects/deselects every item under a folder at once.
 */
export default function useBulkSelection() {
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [selectedFolderPaths, setSelectedFolderPaths] = useState(new Set())
  // Anchor for shift-range selection.
  const lastClickedId = useRef(null)

  const enter = useCallback(() => setBulkMode(true), [])

  const exit = useCallback(() => {
    setBulkMode(false)
    setSelectedIds(new Set())
    setSelectedFolderPaths(new Set())
    lastClickedId.current = null
  }, [])

  // Escape leaves bulk mode, but only when nothing more local should claim the
  // key first: an open dialog (bulk edit / add-to-campaign modals) or a focused
  // text field the user might be trying to clear/blur.
  useEffect(() => {
    if (!bulkMode) return
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role="dialog"]')) return
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      exit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bulkMode, exit])

  const clear = useCallback(() => {
    setSelectedIds(new Set())
    setSelectedFolderPaths(new Set())
    lastClickedId.current = null
  }, [])

  /**
   * Toggle a single item.
   * @param {string} id
   * @param {object} mods - { shift, meta } from the click event, plus the
   *   current flat ordered id list as `orderedIds` for range selection.
   */
  const toggleItem = useCallback((id, { shift, meta, orderedIds } = {}) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const anchor = lastClickedId.current

      if (shift && anchor && orderedIds && orderedIds.length) {
        const start = orderedIds.indexOf(anchor)
        const end = orderedIds.indexOf(id)
        if (start !== -1 && end !== -1) {
          const [lo, hi] = start < end ? [start, end] : [end, start]
          for (let i = lo; i <= hi; i++) next.add(orderedIds[i])
          return next
        }
      }

      // Plain click and cmd/ctrl-click both toggle the single item; the only
      // difference (clearing others) isn't applied here since these views allow
      // accumulating individual selections by design.
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    if (!shift) lastClickedId.current = id
    // Touching individual items invalidates "whole folder" state for any folder
    // it belongs to; callers recompute folder checkbox state from selectedIds,
    // so we only need to keep selectedFolderPaths from going stale on add.
  }, [])

  /**
   * Toggle every item under a folder. If the folder is already fully selected,
   * deselect it; otherwise select all of its items.
   */
  const toggleFolder = useCallback(
    (folderPath, itemsInFolder) => {
      const ids = itemsInFolder.map((i) => i.id)
      setSelectedFolderPaths((prevFolders) => {
        const allSelected = prevFolders.has(folderPath) && ids.every((id) => selectedIds.has(id))
        const nextFolders = new Set(prevFolders)
        allSelected ? nextFolders.delete(folderPath) : nextFolders.add(folderPath)
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (allSelected) ids.forEach((id) => next.delete(id))
          else ids.forEach((id) => next.add(id))
          return next
        })
        return nextFolders
      })
    },
    [selectedIds]
  )

  const count = selectedIds.size + selectedFolderPaths.size

  return {
    bulkMode,
    selectedIds,
    selectedFolderPaths,
    count,
    enter,
    exit,
    clear,
    toggleItem,
    toggleFolder,
    setSelectedIds,
    setSelectedFolderPaths,
  }
}
