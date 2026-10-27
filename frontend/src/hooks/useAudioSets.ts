import { useCallback, useEffect, useState } from 'react'
import api, { type Schema } from '../api'

export type AudioSetSummary = Schema<'AudioSetSummary'>
export type AudioSet = Schema<'AudioSetOut'>

export interface AudioSetsHandle {
  sets: AudioSetSummary[]
  loading: boolean
  /** A failed write's message, or null. */
  error: string | null
  refresh: () => Promise<void>
  save: (
    kind: string,
    name: string | null | undefined,
    entries: Schema<'SetEntryIn'>[] | null | undefined,
    layout?: Schema<'LayoutIn'> | null
  ) => Promise<AudioSet | null>
  /** Not caught: a failure rejects, so the caller can leave live state alone. */
  load: (id: string) => Promise<AudioSet>
  rename: (id: string, name: string | null | undefined) => Promise<AudioSet | null>
  remove: (id: string) => Promise<void>
}

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
export default function useAudioSets(): AudioSetsHandle {
  const [sets, setSets] = useState<AudioSetSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    (
      kind: string,
      name: string | null | undefined,
      entries: Schema<'SetEntryIn'>[] | null | undefined,
      layout?: Schema<'LayoutIn'> | null
    ) => {
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
        .then((created) => refresh().then(() => created as AudioSet))
        .catch((e: Error | null | undefined) => {
          setError(e?.message || 'save failed')
          return null
        })
    },
    [refresh]
  )

  // Deliberately not caught: the caller needs to tell "loaded nothing" from
  // "could not load", so it can leave the live queue/board untouched on failure
  // rather than silently clearing it.
  const load = useCallback((id: string) => api.get(`/audio-sets/${id}`) as Promise<AudioSet>, [])

  const rename = useCallback(
    (id: string, name: string | null | undefined) => {
      const trimmed = (name || '').trim()
      if (!trimmed) return Promise.resolve(null)
      setError(null)
      return api
        .patch(`/audio-sets/${id}`, { name: trimmed })
        .then((updated) => refresh().then(() => updated as AudioSet))
        .catch((e: Error | null | undefined) => {
          setError(e?.message || 'rename failed')
          return null
        })
    },
    [refresh]
  )

  const remove = useCallback(
    (id: string) => {
      setError(null)
      return api
        .delete(`/audio-sets/${id}`)
        .then(() => refresh())
        .catch((e: Error | null | undefined) => {
          setError(e?.message || 'delete failed')
        })
    },
    [refresh]
  )

  return { sets, loading, error, refresh, save, load, rename, remove }
}
