import { useCallback, useEffect, useState } from 'react'
import api from '../api'

/**
 * Server-backed named playlists and soundboards (issue #422).
 *
 * The live queue and the live soundboard stay in browser storage; this is the
 * shelf you save them to, so a board built once comes back next session on any
 * device. Listing is cheap (name + count only) — a set's entries arrive from
 * `load(id)` when it is actually loaded.
 *
 * Exposes:
 *  - sets:    [{ id, kind, name, count, layout, updated_at }]
 *  - loading: true while the list is being (re)fetched
 *  - error:   a failed write's message, or null
 *  - save(kind, name, entries, layout): create or overwrite by (kind, name)
 *  - load(id): fetch one set resolved against the library →
 *              { entries: [{ audio_id, loop, title, artist, has_artwork }], missing }
 *  - rename(id, name) / remove(id)
 */
export default function useAudioSets() {
  const [sets, setSets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(() => {
    setLoading(true)
    return api
      .get('/audio-sets')
      .then((r) => setSets(r.sets || []))
      .catch(() => setSets([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const save = useCallback(
    (kind, name, entries, layout) => {
      const trimmed = (name || '').trim()
      if (!trimmed) return Promise.resolve(null)
      setError(null)
      return api
        .post('/audio-sets', {
          kind,
          name: trimmed,
          entries: entries || [],
          ...(layout ? { layout } : {}),
        })
        .then((created) => refresh().then(() => created))
        .catch((e) => {
          setError(e?.message || 'save failed')
          return null
        })
    },
    [refresh]
  )

  // Deliberately not caught: the caller needs to tell "loaded nothing" from
  // "could not load", so it can leave the live queue/board untouched on failure
  // rather than silently clearing it.
  const load = useCallback((id) => api.get(`/audio-sets/${id}`), [])

  const rename = useCallback(
    (id, name) => {
      const trimmed = (name || '').trim()
      if (!trimmed) return Promise.resolve(null)
      setError(null)
      return api
        .patch(`/audio-sets/${id}`, { name: trimmed })
        .then((updated) => refresh().then(() => updated))
        .catch((e) => {
          setError(e?.message || 'rename failed')
          return null
        })
    },
    [refresh]
  )

  const remove = useCallback(
    (id) => {
      setError(null)
      return api
        .delete(`/audio-sets/${id}`)
        .then(() => refresh())
        .catch((e) => {
          setError(e?.message || 'delete failed')
        })
    },
    [refresh]
  )

  return { sets, loading, error, refresh, save, load, rename, remove }
}
