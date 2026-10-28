import { useState, useEffect, useCallback } from 'react'
import api, { type Schema } from '../api'

export type ScanStatus = Schema<'ScanStatusResponse'>

export interface RescanOptions {
  /** A library-relative folder to limit the scan to; null scans everything. */
  scope?: string | null
  metadata_mode?: string
}

export interface ScanStatusHandle {
  status: ScanStatus
  /** The last finished scan that found or changed something; null otherwise. */
  lastResult: ScanStatus | null
  stopping: boolean
  startRescan: (opts?: RescanOptions) => Promise<void>
  stopScan: () => Promise<void>
}

const EMPTY: ScanStatus = {
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
  total_models: 0,
  scanned_models: 0,
  indexed: 0,
  to_index: 0,
  step_done: 0,
  step_total: 0,
  new_books: 0,
  new_maps: 0,
  new_tokens: 0,
  new_audio: 0,
  new_models: 0,
  total_thumbs: 0,
  thumbs_done: 0,
  thumbs_current: null,
  updated_books: 0,
}

// Fired when any instance starts a scan, so the others on screen (the settings
// header quick action and the Maintenance section, say) switch to fast polling
// at once instead of looking idle until their next 30s poll.
export const SCAN_STARTED = 'grimoire:scan-started'

/**
 * Polls /scan-status and exposes the current scan state plus a helper to start a
 * (optionally scoped) rescan. Shared by the Settings maintenance panel and the
 * per-folder rescan controls so there is a single notion of "is a scan running".
 *
 * Polls every second while a scan is running, every 30s when idle.
 */
export default function useScanStatus(): ScanStatusHandle {
  const [status, setStatus] = useState<ScanStatus>(EMPTY)
  const [lastResult, setLastResult] = useState<ScanStatus | null>(null)
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
              s.new_books! +
              s.new_maps! +
              s.new_tokens! +
              (s.new_audio || 0) +
              (s.new_models || 0) +
              (s.updated_books || 0)
            if (total > 0 || s.indexed! > 0) setLastResult(s)
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

  useEffect(() => {
    const onStarted = () => {
      setLastResult(null)
      setStatus((s) => (s.running ? s : { ...s, running: true, phase: 'scanning' }))
    }
    window.addEventListener(SCAN_STARTED, onStarted)
    return () => window.removeEventListener(SCAN_STARTED, onStarted)
  }, [])

  const startRescan = useCallback(
    async ({ scope = null, metadata_mode = 'new' }: RescanOptions = {}) => {
      if (status.running) return
      setLastResult(null)
      setStopping(false)
      setStatus((s) => ({ ...s, running: true, phase: 'scanning' }))
      try {
        await api.post('/rescan', { scope, metadata_mode })
        window.dispatchEvent(new Event(SCAN_STARTED))
      } catch (_) {
        setStatus((s) => ({ ...s, running: false, phase: null }))
        throw _
      }
    },
    [status.running]
  )

  // A scan whose process died is cleared outright rather than asked to stop
  // (issue #524), and one that already finished has nothing to stop. Either way
  // nothing is running, so drop back to idle now instead of showing "Stopping…"
  // until the next poll.
  const stopScan = useCallback(async () => {
    setStopping(true)
    try {
      const result = await api.post('/cancel-scan')
      if (result?.status === 'cleared_stale' || result?.status === 'not_running') {
        setStopping(false)
        setStatus((s) => ({ ...s, running: false, phase: null }))
      }
    } catch {}
  }, [])

  return { status, lastResult, stopping, startRescan, stopScan }
}
