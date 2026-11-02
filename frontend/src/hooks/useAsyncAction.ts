import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Busy and error state for a request a handler starts, so a failure shows a
 * message instead of a click that does nothing or a spinner that never ends
 * (issue #785).
 *
 * `run(fn)` clears the error, marks busy, and resolves to what `fn` resolves to,
 * or to `undefined` once it has recorded the failure. It never rejects, so a
 * handler can fire it with `void run(...)`. Nothing is set after unmount.
 */
export default function useAsyncAction() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true)
      setError('')
      try {
        return await fn()
      } catch (e) {
        if (mounted.current) setError((e as Error | undefined)?.message || t('common.error'))
        return undefined
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [t]
  )

  return { run, busy, error, setError }
}
