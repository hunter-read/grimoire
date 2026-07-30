import { useCallback, useEffect, useState } from 'react'
import api from '../api'

/**
 * Server-backed named sort/filter presets for one scope
 * (systems | books | maps | tokens | audio).
 *
 * Presets and the per-scope default live on the server (see the saved-filters
 * API), so they follow the user across devices. Exposes:
 *  - saved:   [{ id, scope, name, state, is_default }]
 *  - loaded:  false until the first fetch resolves (so callers can wait before
 *             applying a default on page load)
 *  - defaultFilter: the preset flagged is_default, or null
 *  - save(name, state, { asDefault }): create/overwrite a preset
 *  - setDefault(id, value=true): mark/unmark a preset as the scope default
 *  - remove(id): delete a preset
 */
export default function useSavedFilters(scope) {
  const [saved, setSaved] = useState([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    api
      .get(`/saved-filters?scope=${encodeURIComponent(scope)}`)
      .then((r) => setSaved(r.filters || []))
      .catch(() => setSaved([]))
      .finally(() => setLoaded(true))
  }, [scope])

  useEffect(() => {
    load()
  }, [load])

  const save = useCallback(
    (name, state, { asDefault = false } = {}) => {
      const trimmed = (name || '').trim()
      if (!trimmed) return Promise.resolve(null)
      return api
        .post('/saved-filters', { scope, name: trimmed, state, is_default: asDefault })
        .then((created) => {
          load()
          return created
        })
        .catch(() => null)
    },
    [scope, load]
  )

  const setDefault = useCallback(
    (id, value = true) =>
      api
        .patch(`/saved-filters/${id}`, { is_default: value })
        .then(() => load())
        .catch(() => {}),
    [load]
  )

  const remove = useCallback(
    (id) =>
      api
        .delete(`/saved-filters/${id}`)
        .then(() => load())
        .catch(() => {}),
    [load]
  )

  const defaultFilter = saved.find((f) => f.is_default) || null

  return { saved, loaded, defaultFilter, save, setDefault, remove }
}
