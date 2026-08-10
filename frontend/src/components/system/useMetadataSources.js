import { useEffect, useState } from 'react'
import api from '../../api'

// The source list depends only on which add-ons are installed and what target
// they serve ('game-system' / 'book') — never on the resource being edited (the
// id in the URL is only an existence check server-side). So one fetch per kind
// answers for every system and every book.
//
// This matters most in bulk edit: paging through a 40-system selection used to
// fire 40 identical requests, and the "Fetch metadata" button popped in a beat
// late on each one. Cached per kind, only the first system pays.
//
// The cache holds the promise, not just the result, so editors mounting
// together share one in-flight request instead of racing to issue their own.
const cache = new Map()

// Resolved values are kept alongside the promises so a warm hook can seed its
// initial state synchronously — awaiting even a settled promise costs a tick,
// and that tick is exactly the flash of "no sources" we're removing.
const settled = new Map()

/** Drop cached source lists — call after installing or enabling an add-on. */
export function clearMetadataSourcesCache() {
  cache.clear()
  settled.clear()
}

// The endpoint is addressed per resource, so priming the cache needs some id of
// that kind — any will do, since the answer is identical for all of them.
function loadSources(kind, sampleId) {
  if (!cache.has(kind)) {
    cache.set(
      kind,
      api
        .get(`/${kind}/${sampleId}/metadata-sources`)
        .then((data) => {
          const sources = data.sources || []
          settled.set(kind, sources)
          return sources
        })
        // A failed lookup must not be cached as "no sources forever" — an
        // offline blip would disable the feature for the rest of the session.
        .catch((e) => {
          cache.delete(kind)
          throw e
        })
    )
  }
  return cache.get(kind)
}

/**
 * The metadata add-on sources available for `kind` ('systems' | 'books').
 *
 * `sampleId` is any resource id of that kind — the endpoint is addressed per
 * resource but answers the same for all of them.
 *
 * Returns `{ sources, loading, error }`. On a warm cache `loading` is false and
 * `sources` is populated from the very first render, so paging through a bulk
 * selection neither refetches nor flashes the "an admin can install a metadata
 * scraper" empty state.
 */
export default function useMetadataSources(kind, sampleId) {
  const [state, setState] = useState(() =>
    kind && settled.has(kind)
      ? { sources: settled.get(kind), loading: false, error: '' }
      : { sources: [], loading: !!(kind && sampleId), error: '' }
  )

  useEffect(() => {
    if (!kind || !sampleId) return undefined
    if (settled.has(kind)) {
      setState({ sources: settled.get(kind), loading: false, error: '' })
      return undefined
    }
    let active = true
    // Note: no "start loading" setState here. It would re-run this effect's
    // cleanup on some paths and cancel the very request it announced; the
    // initial state already says loading, and a cold cache is the only way to
    // reach this line.
    loadSources(kind, sampleId)
      .then((sources) => active && setState({ sources, loading: false, error: '' }))
      .catch(
        (e) => active && setState({ sources: [], loading: false, error: e.message || String(e) })
      )
    return () => {
      active = false
    }
  }, [kind, sampleId])

  return state
}
