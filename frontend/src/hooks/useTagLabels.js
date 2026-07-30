import { useState, useEffect } from 'react'
import { tags as tagsApi } from '../api'

/**
 * Fetch the shared-tag display labels for a resource type (issue #235). Returns a
 * map of internal key → display value, so filter UIs can show the nicely-cased
 * display name while still matching on the lowercased internal key.
 *
 * `resourceType` is one of system|book|map|token|audio (or falsy to skip). The
 * map only covers item tags stored in the shared-tag tables; callers fall back
 * to a Title-Cased internal for anything not present (e.g. folder-only tags).
 */
export default function useTagLabels(resourceType) {
  const [labels, setLabels] = useState({})

  useEffect(() => {
    // No-op when there's no scope, or when the tags API isn't available (e.g. a
    // partial test mock) — callers fall back to Title-Cased internal keys.
    if (!resourceType || typeof tagsApi?.list !== 'function') {
      setLabels({})
      return
    }
    let cancelled = false
    tagsApi
      .list(resourceType)
      .then((r) => {
        if (cancelled) return
        const map = {}
        for (const tg of r.tags || []) map[tg.internal] = tg.display
        setLabels(map)
      })
      .catch(() => {
        if (!cancelled) setLabels({})
      })
    return () => {
      cancelled = true
    }
  }, [resourceType])

  return labels
}

/** Title-case fallback for an internal tag key with no shared display value. */
export function titleCaseTag(internal) {
  return String(internal)
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}
