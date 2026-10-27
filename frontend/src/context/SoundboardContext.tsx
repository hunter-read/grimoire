import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import api, { mediaUrl } from '../api'

const SoundboardContext = createContext(null)

const PADS_KEY = 'grimoire:soundboard:pads'
const LAYOUT_KEY = 'grimoire:soundboard:layout'
const POSITION_KEY = 'grimoire:soundboard:position'

// Grid bounds. Columns stay narrow so pads remain comfortably tappable; rows go
// deeper because the panel scrolls vertically (so 5x5, 3x8 and 1x15 all fit).
export const MIN_COLS = 1
export const MAX_COLS = 8
export const MIN_ROWS = 1
export const MAX_ROWS = 15

export const DEFAULT_LAYOUT = { cols: 4, rows: 4 }

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)

export const clampLayout = (layout) => ({
  cols: clamp(Math.round(Number(layout?.cols) || DEFAULT_LAYOUT.cols), MIN_COLS, MAX_COLS),
  rows: clamp(Math.round(Number(layout?.rows) || DEFAULT_LAYOUT.rows), MIN_ROWS, MAX_ROWS),
})

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

/**
 * Like useState, but persisted in localStorage so the soundboard survives both
 * navigation and a full reload. The board is a piece of the user's table setup,
 * not a per-visit queue, so unlike the audio queue (sessionStorage) it is kept
 * indefinitely.
 */
function usePersistentState(key, initial, hydrate = (v) => v) {
  const [value, setValue] = useState(() => hydrate(readStored(key, initial)))
  const first = useRef(true)
  useEffect(() => {
    // Skip the write on mount so simply opening the app doesn't rewrite storage.
    if (first.current) {
      first.current = false
      return
    }
    writeStored(key, value)
  }, [key, value])
  return [value, setValue]
}

// A pad needs hydrating if it was added with only an id (campaign resource, note
// embed) and we haven't already resolved — or failed — a lookup for it.
const needsHydration = (p) => p && p.id && !p.title && !p._hydrated

/**
 * The soundboard: a movable grid of one-shot sound pads that play *over*
 * whatever the main audio player is doing.
 *
 * Each pad owns its own <audio> element created on demand, so a pad layers over
 * the playlist and over other pads, and tapping a playing pad restarts it. That
 * is the whole point of a soundboard — the global player (AudioPlayerContext)
 * owns exactly one element for the playlist, and this owns everything else.
 *
 * Pads, grid size, and panel position all persist in localStorage.
 */
export function SoundboardProvider({ children }) {
  const [pads, setPads] = usePersistentState(PADS_KEY, [], (v) => (Array.isArray(v) ? v : []))
  const [layout, setLayout] = usePersistentState(LAYOUT_KEY, DEFAULT_LAYOUT, clampLayout)
  // null position means "unplaced" — the panel pins itself to the bottom-right
  // corner until the user drags it somewhere.
  const [position, setPosition] = usePersistentState(POSITION_KEY, null)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  // Ids of pads with a sound currently playing, for the pad's active styling.
  const [playingIds, setPlayingIds] = useState(() => new Set())

  // Live <audio> elements keyed by pad id. Never persisted — a reload starts
  // silent, which is what you want from a sound-effects board.
  const elements = useRef(new Map())

  const markPlaying = useCallback((id, playing) => {
    setPlayingIds((prev) => {
      if (playing === prev.has(id)) return prev
      const next = new Set(prev)
      playing ? next.add(id) : next.delete(id)
      return next
    })
  }, [])

  const stop = useCallback(
    (id) => {
      const el = elements.current.get(id)
      if (el) {
        el.pause()
        el.currentTime = 0
      }
      markPlaying(id, false)
    },
    [markPlaying]
  )

  /**
   * Fire a pad. A pad already playing restarts from the top rather than
   * stopping — a soundboard button should always make its noise.
   */
  const trigger = useCallback(
    (pad) => {
      if (!pad || !pad.id) return
      let el = elements.current.get(pad.id)
      if (!el) {
        el = new Audio(mediaUrl(`/audio/${pad.id}/file`))
        el.addEventListener('ended', () => {
          if (!el.loop) markPlaying(pad.id, false)
        })
        el.addEventListener('pause', () => {
          if (el.currentTime === 0 || el.ended) markPlaying(pad.id, false)
        })
        elements.current.set(pad.id, el)
      }
      el.loop = !!pad.loop
      el.volume = typeof pad.volume === 'number' ? clamp(pad.volume, 0, 1) : 1
      el.currentTime = 0
      el.play()
        .then(() => markPlaying(pad.id, true))
        .catch(() => markPlaying(pad.id, false))
    },
    [markPlaying]
  )

  /** Tap behaviour: a looping pad toggles, a one-shot always (re)fires. */
  const toggle = useCallback(
    (pad) => {
      if (pad?.loop && playingIds.has(pad.id)) {
        stop(pad.id)
        return
      }
      trigger(pad)
    },
    [playingIds, stop, trigger]
  )

  const stopAll = useCallback(() => {
    elements.current.forEach((el) => {
      el.pause()
      el.currentTime = 0
    })
    setPlayingIds(new Set())
  }, [])

  /**
   * Add one or more tracks as pads. Ids already on the board are skipped, so
   * re-adding a selection is harmless. Opens the panel so the new pads are
   * visible — adding a sound you then can't find would be a dead end.
   *
   * @returns {number} how many pads were actually added
   */
  const addPads = useCallback(
    (tracks) => {
      const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t && t.id)
      if (list.length === 0) return 0

      // Work out what is new against the current `pads` before updating, so the
      // count we report back is derived here rather than inside the updater —
      // an updater can run more than once per commit, which would make a
      // counter assigned in it unreliable.
      const existing = new Set(pads.map((p) => p.id))
      const fresh = []
      list.forEach((t) => {
        if (existing.has(t.id)) return
        existing.add(t.id)
        fresh.push({ id: t.id, title: t.title || '', loop: false })
      })
      if (fresh.length === 0) return 0

      // The updater still de-dupes against `prev`, so two adds in one tick
      // can't both append the same pad.
      setPads((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        const toAdd = fresh.filter((p) => !seen.has(p.id))
        return toAdd.length ? [...prev, ...toAdd] : prev
      })
      setOpen(true)
      return fresh.length
    },
    [pads, setPads]
  )

  const removePad = useCallback(
    (id) => {
      stop(id)
      elements.current.delete(id)
      setPads((prev) => prev.filter((p) => p.id !== id))
    },
    [setPads, stop]
  )

  const setPadLoop = useCallback(
    (id, loop) => {
      setPads((prev) => prev.map((p) => (p.id === id ? { ...p, loop } : p)))
      const el = elements.current.get(id)
      if (el) el.loop = loop
    },
    [setPads]
  )

  /** Move the pad at `from` to index `to`, for drag-to-rearrange in edit mode. */
  const movePad = useCallback(
    (from, to) => {
      setPads((prev) => {
        if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length)
          return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      })
    },
    [setPads]
  )

  const clearPads = useCallback(() => {
    stopAll()
    elements.current.clear()
    setPads([])
  }, [setPads, stopAll])

  /**
   * Swap the whole board for a new set of pads, keeping each pad's loop flag.
   *
   * Loading a saved board (issue #422) is a wholesale replace, not an add, and
   * it cannot be expressed as clearPads() + addPads(): both read the same
   * committed `pads`, so addPads would treat every track shared with the
   * outgoing board as a duplicate and silently drop it. Replacing in one step
   * also means the board never renders empty in between.
   */
  const replacePads = useCallback(
    (tracks) => {
      const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t && t.id)
      stopAll()
      elements.current.clear()
      const seen = new Set()
      const next = []
      list.forEach((t) => {
        if (seen.has(t.id)) return
        seen.add(t.id)
        next.push({ id: t.id, title: t.title || '', loop: !!t.loop })
      })
      setPads(next)
      setOpen(true)
      return next.length
    },
    [setPads, stopAll]
  )

  const updateLayout = useCallback(
    (next) => setLayout((prev) => clampLayout({ ...prev, ...next })),
    [setLayout]
  )

  const resetPosition = useCallback(() => setPosition(null), [setPosition])

  const hasPad = useCallback((id) => pads.some((p) => p.id === id), [pads])

  const isPadPlaying = useCallback((id) => playingIds.has(id), [playingIds])

  const toggleOpen = useCallback(() => setOpen((o) => !o), [])

  // Stop every sound when the provider unmounts, so a logout or app teardown
  // doesn't leave audio playing with no UI attached to it.
  useEffect(() => {
    const live = elements.current
    return () => {
      live.forEach((el) => el.pause())
      live.clear()
    }
  }, [])

  // Lazily fill in titles for pads added with only an id. Each id is fetched at
  // most once; a failure marks the pad resolved so we don't retry forever.
  const hydrating = useRef(new Set())
  useEffect(() => {
    const pending = pads.filter((p) => needsHydration(p) && !hydrating.current.has(p.id))
    if (pending.length === 0) return
    const ids = [...new Set(pending.map((p) => p.id))]
    ids.forEach((id) => hydrating.current.add(id))
    ids.forEach((id) => {
      api
        .get(`/audio/${id}`)
        .then((data) => {
          setPads((prev) =>
            prev.map((p) =>
              p.id === id
                ? { ...p, title: p.title || data.title || data.filename, _hydrated: true }
                : p
            )
          )
        })
        .catch(() => {
          setPads((prev) => prev.map((p) => (p.id === id ? { ...p, _hydrated: true } : p)))
        })
        .finally(() => {
          hydrating.current.delete(id)
        })
    })
  }, [pads, setPads])

  const value = {
    pads,
    layout,
    position,
    open,
    editing,
    // actions
    addPads,
    removePad,
    movePad,
    setPadLoop,
    clearPads,
    replacePads,
    trigger,
    toggle,
    stop,
    stopAll,
    setPosition,
    resetPosition,
    updateLayout,
    setOpen,
    toggleOpen,
    setEditing,
    // selectors
    hasPad,
    isPadPlaying,
  }

  return <SoundboardContext.Provider value={value}>{children}</SoundboardContext.Provider>
}

export function useSoundboard() {
  const ctx = useContext(SoundboardContext)
  // A no-op fallback keeps "add to soundboard" buttons safe to render in
  // isolated component tests that don't wrap with the provider.
  return ctx || NOOP_BOARD
}

const NOOP = () => {}
const NOOP_BOARD = {
  pads: [],
  layout: DEFAULT_LAYOUT,
  position: null,
  open: false,
  editing: false,
  addPads: () => 0,
  removePad: NOOP,
  movePad: NOOP,
  setPadLoop: NOOP,
  clearPads: NOOP,
  replacePads: () => 0,
  trigger: NOOP,
  toggle: NOOP,
  stop: NOOP,
  stopAll: NOOP,
  setPosition: NOOP,
  resetPosition: NOOP,
  updateLayout: NOOP,
  setOpen: NOOP,
  toggleOpen: NOOP,
  setEditing: NOOP,
  hasPad: () => false,
  isPadPlaying: () => false,
}
