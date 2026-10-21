import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { duplicates as dupesApi } from '../api'
import { filterGroups, type DuplicateGroup, type GroupFilters } from '../utils/duplicateGroups'

// The groups endpoint's page cap. The queue walks one page - a review session
// that clears 200 groups reloads the list for the next batch.
const QUEUE_SIZE = 200

/**
 * The duplicate review queue (issue #589): which group is in front of the
 * user, where it sits in the list, and what comes after it.
 *
 * Resolving a group used to bounce back to the list, so every decision cost a
 * round trip and a click to find the next one. The queue is loaded once, with
 * the same filters as the list, and walked in place: resolved groups drop out
 * locally (the server agrees on the next load - a merged group's members are
 * gone, a linked one has collapsed into a family, a dismissed one is pruned),
 * and skipped ones stay to come round again.
 *
 * `groupId` null leaves the queue idle, for a comparison opened outside it.
 */
export default function useReviewQueue(groupId: string | null, filters: GroupFilters) {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [resolved, setResolved] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const active = !!groupId

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    dupesApi
      .groups({ limit: QUEUE_SIZE })
      .then((data) => {
        if (!cancelled) setGroups(data.groups || [])
      })
      .catch((e: Error) => {
        if (cancelled) return
        setGroups([])
        setError(e.message || t('maintenance.dupes.loadFailed'))
      })
    return () => {
      cancelled = true
    }
    // Loaded once per visit: walking the queue must not refetch it per group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const queue = useMemo(
    () => filterGroups(groups, filters).filter((g) => !resolved.has(g.id)),
    // The filters are read by value; the object is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, resolved, filters.type, filters.match]
  )
  const index = queue.findIndex((g) => g.id === groupId)
  const group = groups?.find((g) => g.id === groupId) ?? null

  /** The group to show once the current one is settled, or null at the end. */
  const afterResolve = useCallback((): DuplicateGroup | null => {
    const rest = queue.filter((g) => g.id !== groupId)
    if (rest.length === 0) return null
    // The one after the current group now sits at its index; past the end,
    // wrap round to anything that was skipped.
    return rest[Math.max(index, 0)] ?? rest[0]
  }, [queue, groupId, index])

  const markResolved = useCallback(
    (id: string) => setResolved((prev) => new Set([...prev, id])),
    []
  )

  return {
    loading: active && groups === null,
    error,
    group,
    index,
    total: queue.length,
    next: index >= 0 ? (queue[index + 1] ?? null) : null,
    prev: index > 0 ? queue[index - 1] : null,
    afterResolve,
    markResolved,
  }
}
