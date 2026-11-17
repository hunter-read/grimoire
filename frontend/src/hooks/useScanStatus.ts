import { useSyncExternalStore } from 'react'
import api, { type Schema } from '../api'
import { startIdleAwareInterval } from '../lib/userActivity'

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

// Fired when something other than this hook starts a scan (saving an export to
// the library does), so every scan control on screen switches to fast polling
// at once instead of looking idle until the next 30s poll.
export const SCAN_STARTED = 'grimoire:scan-started'

const POLL_RUNNING_MS = 1000
const POLL_IDLE_MS = 30000

interface Snapshot {
  status: ScanStatus
  lastResult: ScanStatus | null
  stopping: boolean
}

const INITIAL: Snapshot = { status: EMPTY, lastResult: null, stopping: false }

// One copy of the scan state for the whole page. A folder view puts a rescan
// button on every group, and each used to run its own poll of /scan-status:
// six groups on screen meant six requests every 30 seconds for one answer.
let snapshot = INITIAL
const subscribers = new Set<() => void>()
let stopPolling: (() => void) | undefined
let polledAsRunning: boolean | undefined
// Bumped when the last subscriber leaves, so a reply still in flight from
// before then is dropped instead of landing in the next mount's state.
let generation = 0

function update(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch }
  subscribers.forEach((notify) => notify())
  schedule()
}

function found(s: ScanStatus): boolean {
  const total =
    s.new_books! +
    s.new_maps! +
    s.new_tokens! +
    (s.new_audio || 0) +
    (s.new_models || 0) +
    (s.updated_books || 0)
  return total > 0 || s.indexed! > 0
}

function poll(): void {
  const asked = generation
  api
    .get('/scan-status')
    .then((s) => {
      if (asked !== generation) return
      update(!s.running && found(s) ? { status: s, lastResult: s } : { status: s })
    })
    .catch(() => {})
}

/**
 * Poll at the pace the current state calls for. A scan starting or ending
 * changes the pace, and polls once straight away so the first answer at the new
 * one is not a whole interval off.
 */
function schedule(): void {
  if (subscribers.size === 0) return
  const running = snapshot.status.running
  if (polledAsRunning === running) return
  polledAsRunning = running
  stopPolling?.()
  stopPolling = startIdleAwareInterval(poll, running ? POLL_RUNNING_MS : POLL_IDLE_MS)
  poll()
}

function onStartedElsewhere(): void {
  update({
    lastResult: null,
    status: snapshot.status.running
      ? snapshot.status
      : { ...snapshot.status, running: true, phase: 'scanning' },
  })
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify)
  if (subscribers.size === 1) {
    window.addEventListener(SCAN_STARTED, onStartedElsewhere)
    schedule()
  }
  return () => {
    subscribers.delete(notify)
    if (subscribers.size > 0) return
    window.removeEventListener(SCAN_STARTED, onStartedElsewhere)
    stopPolling?.()
    stopPolling = undefined
    polledAsRunning = undefined
    generation++
    snapshot = INITIAL
  }
}

const getSnapshot = (): Snapshot => snapshot

async function startRescan({
  scope = null,
  metadata_mode = 'new',
}: RescanOptions = {}): Promise<void> {
  if (snapshot.status.running) return
  update({
    lastResult: null,
    stopping: false,
    status: { ...snapshot.status, running: true, phase: 'scanning' },
  })
  try {
    await api.post('/rescan', { scope, metadata_mode })
  } catch (e) {
    update({ status: { ...snapshot.status, running: false, phase: null } })
    throw e
  }
}

// A scan whose process died is cleared outright rather than asked to stop
// (issue #524), and one that already finished has nothing to stop. Either way
// nothing is running, so drop back to idle now instead of showing "Stopping…"
// until the next poll.
//
// A request that fails stops nothing, so the Stop button comes back for another
// try, and the error is rethrown - as startRescan's is - for the caller to show.
async function stopScan(): Promise<void> {
  update({ stopping: true })
  try {
    const result = await api.post('/cancel-scan')
    if (result?.status === 'cleared_stale' || result?.status === 'not_running') {
      update({ stopping: false, status: { ...snapshot.status, running: false, phase: null } })
    }
  } catch (e) {
    update({ stopping: false })
    throw e
  }
}

/**
 * The current library scan, plus helpers to start a (optionally scoped) rescan
 * and to stop one. Every instance on the page shares one state and one poll of
 * /scan-status, so there is a single notion of "is a scan running".
 *
 * Polls every second while a scan is running, every 30s when idle, and not at
 * all while nobody is using the tab (see `startIdleAwareInterval`).
 */
export default function useScanStatus(): ScanStatusHandle {
  const { status, lastResult, stopping } = useSyncExternalStore(subscribe, getSnapshot)
  return { status, lastResult, stopping, startRescan, stopScan }
}
