import { useCallback, useMemo } from 'react'

import useBulkSelection from './useBulkSelection'
import type { SelectedItem } from './useBulkMerge'
import type { SelectMods } from '../components/SelectableCard'

const key = (type: string, id: string) => `${type}:${id}`

/**
 * Bulk selection over a list that mixes collections - favorites, a tag's
 * items, search results (issue #589).
 *
 * useBulkSelection tracks bare ids, which is enough inside one collection but
 * not here: a map and a book never share an id in practice, yet nothing makes
 * that a rule. So each item is tracked as `type:id`, and `selected` hands back
 * the pairs a bulk action needs.
 */
export default function useMixedSelection(orderedItems: SelectedItem[] = []) {
  const bulk = useBulkSelection()
  const orderedIds = useMemo(() => orderedItems.map((i) => key(i.type, i.id)), [orderedItems])

  const isSelected = useCallback(
    (type: string, id: string) => bulk.selectedIds.has(key(type, id)),
    [bulk.selectedIds]
  )
  const toggle = useCallback(
    (type: string, id: string, mods: Partial<SelectMods> = {}) =>
      bulk.toggleItem(key(type, id), { ...mods, orderedIds }),
    [bulk, orderedIds]
  )
  const selected = useMemo(
    () =>
      [...(bulk.selectedIds as Set<string>)].map((k) => {
        const cut = k.indexOf(':')
        return { type: k.slice(0, cut), id: k.slice(cut + 1) }
      }),
    [bulk.selectedIds]
  )
  const forget = useCallback(
    (ids: Iterable<string>) => {
      const gone = new Set(ids)
      bulk.setSelectedIds(
        (prev: Set<string>) =>
          new Set([...prev].filter((k) => !gone.has(k.slice(k.indexOf(':') + 1))))
      )
    },
    [bulk]
  )

  return { bulk, isSelected, toggle, selected, forget }
}
