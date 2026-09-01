import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import api from '../api'

// The API path segment differs from the download segment for audio only, but
// every caller already knows its download type, so that is what is passed in.
const DETAIL_PATH = {
  books: 'books',
  maps: 'maps',
  tokens: 'tokens',
  audio: 'audio',
}

/**
 * The versions of one item, fetched on demand for a download picker.
 *
 * List rows carry only `variant_count`, so the family is fetched the first time
 * the user actually opens the picker rather than on render — a shelf of 200
 * cards must not fire 200 requests for a menu nobody opened. Mirrors the
 * fetch-on-expand approach in VariantMenuItems.
 *
 * `item` may already carry a `variants` array (detail responses do), in which
 * case it is used as-is and no request is made.
 */
export default function useVariantOptions(type, id, item) {
  const { t } = useTranslation()
  const [fetched, setFetched] = useState(null)
  const [loading, setLoading] = useState(false)
  // `loading` state cannot guard the fetch on its own: `load` runs from a click
  // handler, so the `setLoading(true)` re-render replaces this callback before
  // a second call could observe the new value. The ref is the guard that is
  // true immediately.
  const requested = useRef(false)

  // A detail payload already holds the whole family; a list row does not.
  const inline = item && Array.isArray(item.variants) ? item : null

  const load = useCallback(() => {
    if (inline || requested.current) return
    const segment = DETAIL_PATH[type]
    if (!segment) return
    requested.current = true
    setLoading(true)
    api
      .get(`/${segment}/${id}`)
      .then((data) => setFetched(data))
      .catch(() => setFetched({ variants: [] }))
      .finally(() => setLoading(false))
  }, [inline, type, id])

  const source = inline || fetched
  const options = source
    ? [
        {
          id: source.variant_main_id || source.id || id,
          isMain: true,
          filename: source.filename,
        },
        ...(source.variants || []).map((v) => ({ ...v, isMain: false })),
      ]
    : []

  const label = useCallback(
    (option) => {
      if (option.isMain) return t('variants.mainVersion')
      if (option.label) return option.label
      return t(`variants.kind.${option.kind}`, { defaultValue: option.kind })
    },
    [t]
  )

  return { options, loading, load, label }
}
