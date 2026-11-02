import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import api, { type ApiError } from '../api'

export interface CancellableFetch<T> {
  /** The latest response for the current URL, or null until it arrives. */
  data: T | null
  /** Replace the data in place, after an edit returns the updated item. */
  setData: Dispatch<SetStateAction<T | null>>
  /** Set when the request failed; `notFound` when it failed with a 404. */
  error: { message: string; notFound: boolean } | null
  /** Fetch the current URL again. */
  reload: () => void
}

/**
 * `api.get(url)` for a detail view, keeping only the response to the URL it is
 * on now (issue #785).
 *
 * Stepping quickly between items starts a request per item, and they can come
 * back in any order; a response for a URL the view has already left is
 * dropped, so the page never shows the previous item. A failure, a 404
 * included, is reported in `error` instead of leaving the caller on a spinner.
 * `data` goes back to null whenever the URL changes. A null URL fetches nothing.
 */
export default function useCancellableFetch<T>(url: string | null): CancellableFetch<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<CancellableFetch<T>['error']>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // Cleared when the URL changes, on reload, and on unmount: a response that
    // arrives after any of those belongs to a page the view has left.
    let current = true
    setData(null)
    setError(null)
    if (url === null) return
    api
      .get(url)
      .then((body) => {
        if (current) setData(body as T)
      })
      .catch((e: unknown) => {
        if (!current) return
        const err = e as ApiError | undefined
        setError({ message: err?.message || '', notFound: err?.status === 404 })
      })
    return () => {
      current = false
    }
  }, [url, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { data, setData, error, reload }
}
