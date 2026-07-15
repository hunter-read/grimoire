import { useState, useEffect, useCallback } from 'react'
import api from '../api'

const EMPTY = {
  running: false,
  phase: null,
  total_books: 0,
  scanned_books: 0,
  total_maps: 0,
  scanned_maps: 0,
  total_tokens: 0,
  scanned_tokens: 0,
  total_audio: 0,
  scanned_audio: 0,
  indexed: 0,
  to_index: 0,
  new_books: 0,
  new_maps: 0,
  new_tokens: 0,
  new_audio: 0,
  updated_books: 0,
}

/**
 * Polls /scan-status and exposes the current scan state plus a helper to start a
 * (optionally scoped) rescan. Shared by the Settings maintenance panel and the
 * per-folder rescan controls so there is a single notion of "is a scan running".
 *
 * Polls every second while a scan is running, every 30s when idle.
 */
export default function useScanStatus() {
  const [status, setStatus] = useState(EMPTY)
  const [lastResult, setLastResult] = useState(null)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      api
        .get('/scan-status')
        .then((s) => {
          if (cancelled) return
          setStatus(s)
          if (!s.running) {
            const total =
              s.new_books + s.new_maps + s.new_tokens + (s.new_audio || 0) + (s.updated_books || 0)
            if (total > 0 || s.indexed > 0) setLastResult(s)
          }
        })
        .catch(() => {})
    }

    poll()
    const id = setInterval(poll, status.running ? 1000 : 30000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [status.running])

  const startRescan = useCallback(
    async ({ scope = null, metadata_mode = 'new' } = {}) => {
      if (status.running) return
      setLastResult(null)
      setStopping(false)
      setStatus((s) => ({ ...s, running: true, phase: 'scanning' }))
      try {
        await api.post('/rescan', { scope, metadata_mode })
      } catch (_) {
        setStatus((s) => ({ ...s, running: false, phase: null }))
        throw _
      }
    },
    [status.running]
  )

  const stopScan = useCallback(async () => {
    setStopping(true)
    try {
      await api.post('/cancel-scan')
    } catch (_) {}
  }, [])

  return { status, lastResult, stopping, startRescan, stopScan }
}
