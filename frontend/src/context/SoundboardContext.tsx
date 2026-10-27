import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useEffect,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import api, { mediaUrl, type Schema } from '../api'

/** One pad on the board. */
export interface SoundboardPad {
  id: string
  title: string
  loop: boolean
  /** 0..1; a pad without one plays at full volume. */
  volume?: number
  /** Set once a lazy GET /audio/:id has resolved (or failed) for this pad. */
  _hydrated?: boolean
}

/** What `addPads` / `replacePads` accept: any track-like object with an id. */
export interface SoundboardTrack {
  id: string
  title?: string
  loop?: boolean
}

export interface SoundboardLayout {
  cols: number
  rows: number
}

/** Where the user dragged the panel; null means pinned bottom-right. */
export interface SoundboardPosition {
  left: number
  top: number
}

/** What `trigger`/`toggle` read: an id, and the pad's loop and volume if set. */
export type SoundboardPadRef = Pick<SoundboardPad, 'id'> & Partial<SoundboardPad>

export interface SoundboardContextValue {
  pads: SoundboardPad[]
  layout: SoundboardLayout
  position: SoundboardPosition | null
  open: boolean
  editing: boolean
  // actions
  addPads: (tracks: SoundboardTrack | SoundboardTrack[] | null | undefined) => number
  removePad: (id: string) => void
  movePad: (from: number, to: number) => void
  setPadLoop: (id: string, loop: boolean) => void
  clearPads: () => void
  replacePads: (tracks: SoundboardTrack | SoundboardTrack[] | null | undefined) => number
  trigger: (pad: SoundboardPadRef | null | undefined) => void
  toggle: (pad: SoundboardPadRef | null | undefined) => void
  stop: (id: string) => void
  stopAll: () => void
  setPosition: Dispatch<SetStateAction<SoundboardPosition | null>>
  resetPosition: () => void
  updateLayout: (next: Partial<SoundboardLayout>) => void
  setOpen: Dispatch<SetStateAction<boolean>>
  toggleOpen: () => void
  setEditing: Dispatch<SetStateAction<boolean>>
  // selectors
  hasPad: (id: string) => boolean
  isPadPlaying: (id: string) => boolean
}

const SoundboardContext = createContext<SoundboardContextValue | null>(null)

const PADS_KEY = 'grimoire:soundboard:pads'
const LAYOUT_KEY = 'grimoire:soundboard:layout'
const POSITION_KEY = 'grimoire:soundboard:position'

// Grid bounds. Columns stay narrow so pads remain comfortably tappable; rows go
// deeper because the panel scrolls vertically (so 5x5, 3x8 and 1x15 all fit).
export const MIN_COLS = 1
export const MAX_COLS = 8
export const MIN_ROWS = 1
export const MAX_ROWS = 15

export const DEFAULT_LAYOUT: SoundboardLayout = { cols: 4, rows: 4 }

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

export const clampLayout = (
  layout: Partial<Record<keyof SoundboardLayout, unknown>> | null | undefined
): SoundboardLayout => ({
  cols: clamp(Math.round(Number(layout?.cols) || DEFAULT_LAYOUT.cols), MIN_COLS, MAX_COLS),
  rows: clamp(Math.round(Number(layout?.rows) || DEFAULT_LAYOUT.rows), MIN_ROWS, MAX_ROWS),
})

function readStored(key: string, fallback: unknown): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: unknown): void {
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
function usePersistentState<T>(
  key: string,
  initial: T,
  hydrate: (stored: unknown) => T = (v) => v as T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => hydrate(readStored(key, initial)))
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
const needsHydration = (p: SoundboardPad | null | undefined) =>
  p && p.id && !p.title && !p._hydrated

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
export function SoundboardProvider({ children }: { children?: ReactNode }) {
  const [pads, setPads] = usePersistentState<SoundboardPad[]>(PADS_KEY, [], (v) =>
    Array.isArray(v) ? v : []
  )
  const [layout, setLayout] = usePersistentState(
    LAYOUT_KEY,
    DEFAULT_LAYOUT,
    clampLayout as (stored: unknown) => SoundboardLayout
  )
  // null position means "unplaced" — the panel pins itself to the bottom-right
  // corner until the user drags it somewhere.
  const [position, setPosition] = usePersistentState<SoundboardPosition | null>(POSITION_KEY, null)

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  // Ids of pads with a sound currently playing, for the pad's active styling.
  const [playingIds, setPlayingIds] = useState(() => new Set<string>())

  // Live <audio> elements keyed by pad id. Never persisted — a reload starts
  // silent, which is what you want from a sound-effects board.
  const elements = useRef(new Map<string, HTMLAudioElement>())

  const markPlaying = useCallback((id: string, playing: boolean) => {
    setPlayingIds((prev) => {
      if (playing === prev.has(id)) return prev
      const next = new Set(prev)
      if (playing) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const stop = useCallback(
    (id: string) => {
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
    (pad: SoundboardPadRef | null | undefined) => {
      if (!pad || !pad.id) return
      let el = elements.current.get(pad.id)
      if (!el) {
        const created = new Audio(mediaUrl(`/audio/${pad.id}/file`))
        el = created
        created.addEventListener('ended', () => {
          if (!created.loop) markPlaying(pad.id, false)
        })
        created.addEventListener('pause', () => {
          if (created.currentTime === 0 || created.ended) markPlaying(pad.id, false)
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
    (pad: SoundboardPadRef | null | undefined) => {
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
    (tracks: SoundboardTrack | SoundboardTrack[] | null | undefined) => {
      const list = (Array.isArray(tracks) ? tracks : [tracks]).filter(
        (t): t is SoundboardTrack => !!t && !!t.id
      )
      if (list.length === 0) return 0

      // Work out what is new against the current `pads` before updating, so the
      // count we report back is derived here rather than inside the updater —
      // an updater can run more than once per commit, which would make a
      // counter assigned in it unreliable.
      const existing = new Set(pads.map((p) => p.id))
      const fresh: SoundboardPad[] = []
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
    (id: string) => {
      stop(id)
      elements.current.delete(id)
      setPads((prev) => prev.filter((p) => p.id !== id))
    },
    [setPads, stop]
  )

  const setPadLoop = useCallback(
    (id: string, loop: boolean) => {
      setPads((prev) => prev.map((p) => (p.id === id ? { ...p, loop } : p)))
      const el = elements.current.get(id)
      if (el) el.loop = loop
    },
    [setPads]
  )

  /** Move the pad at `from` to index `to`, for drag-to-rearrange in edit mode. */
  const movePad = useCallback(
    (from: number, to: number) => {
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
    (tracks: SoundboardTrack | SoundboardTrack[] | null | undefined) => {
      const list = (Array.isArray(tracks) ? tracks : [tracks]).filter(
        (t): t is SoundboardTrack => !!t && !!t.id
      )
      stopAll()
      elements.current.clear()
      const seen = new Set<string>()
      const next: SoundboardPad[] = []
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
    (next: Partial<SoundboardLayout>) => setLayout((prev) => clampLayout({ ...prev, ...next })),
    [setLayout]
  )

  const resetPosition = useCallback(() => setPosition(null), [setPosition])

  const hasPad = useCallback((id: string) => pads.some((p) => p.id === id), [pads])

  const isPadPlaying = useCallback((id: string) => playingIds.has(id), [playingIds])

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
  const hydrating = useRef(new Set<string>())
  useEffect(() => {
    const pending = pads.filter((p) => needsHydration(p) && !hydrating.current.has(p.id))
    if (pending.length === 0) return
    const ids = [...new Set(pending.map((p) => p.id))]
    ids.forEach((id) => hydrating.current.add(id))
    ids.forEach((id) => {
      api
        .get(`/audio/${id}`)
        .then((raw) => {
          const data = raw as Schema<'AudioDetailResponse'>
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

  const value: SoundboardContextValue = {
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

export function useSoundboard(): SoundboardContextValue {
  const ctx = useContext(SoundboardContext)
  // A no-op fallback keeps "add to soundboard" buttons safe to render in
  // isolated component tests that don't wrap with the provider.
  return ctx || NOOP_BOARD
}

const NOOP = () => {}
const NOOP_BOARD: SoundboardContextValue = {
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
