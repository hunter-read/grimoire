import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import api from '../api'
import useSessionState from '../hooks/useSessionState'

const AudioPlayerContext = createContext(null)

// A track ref is the minimal shape we need to play + display a queue entry:
//   { id, title?, artist?, artwork? }
// The audio file URL is derived from `id` at play time, so only the id is
// required. Entries added with just an id (campaign resources, note embeds) are
// lazily hydrated from GET /audio/:id so the player/queue show a rich label.

// A track needs hydrating only if it has an id but no display title yet and we
// haven't already resolved (or failed) a fetch for it. Tracks added with a
// title/artist (gallery, detail view) are already rich and never fetched.
const needsHydration = (t) => t && t.id && !t.title && !t._hydrated

/**
 * Owns the single app-wide <audio> element (via `audioRef`, attached by
 * GlobalAudioPlayer) and the playback queue. Every play button in the app is a
 * thin controller that calls these actions instead of owning its own audio.
 *
 * Queue, current index, and repeat mode persist across in-session navigation
 * (sessionStorage) and reset on a hard refresh. Playback state (isPlaying,
 * currentTime) is ephemeral and driven by the <audio> element's events.
 */
export function AudioPlayerProvider({ children }) {
  const audioRef = useRef(null)

  const [queue, setQueue] = useSessionState('grimoire:audio:queue', [])
  const [currentIndex, setCurrentIndex] = useSessionState('grimoire:audio:index', -1)
  const [repeatOne, setRepeatOne] = useSessionState('grimoire:audio:repeatOne', false)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [expanded, setExpanded] = useState(false)

  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null

  // When the current track changes, the GlobalAudioPlayer reloads the <audio>
  // src; we (re)start playback for any index >= 0. A request flag tells the
  // player to call play() once the new src is ready.
  const playRequested = useRef(false)

  const playQueue = useCallback(
    (tracks, startIndex = 0) => {
      const list = (tracks || []).filter((t) => t && t.id)
      if (list.length === 0) return
      const idx = Math.min(Math.max(startIndex, 0), list.length - 1)
      setQueue(list)
      setCurrentIndex(idx)
      playRequested.current = true
      setExpanded(false)
    },
    [setQueue, setCurrentIndex]
  )

  const playNext = useCallback(
    (track) => {
      if (!track || !track.id) return
      setQueue((prev) => {
        if (prev.length === 0) {
          // Nothing playing — start this track immediately.
          setCurrentIndex(0)
          playRequested.current = true
          return [track]
        }
        const next = [...prev]
        next.splice(currentIndex + 1, 0, track)
        return next
      })
    },
    [currentIndex, setQueue, setCurrentIndex]
  )

  const addToQueue = useCallback(
    (track) => {
      if (!track || !track.id) return
      setQueue((prev) => {
        if (prev.length === 0) {
          setCurrentIndex(0)
          playRequested.current = true
          return [track]
        }
        return [...prev, track]
      })
    },
    [setQueue, setCurrentIndex]
  )

  const next = useCallback(() => {
    setCurrentIndex((i) => {
      if (i < queue.length - 1) {
        playRequested.current = true
        return i + 1
      }
      // End of queue — stop.
      playRequested.current = false
      const el = audioRef.current
      if (el) el.pause()
      setIsPlaying(false)
      return i
    })
  }, [queue.length, setCurrentIndex])

  const prev = useCallback(() => {
    const el = audioRef.current
    // If we're more than ~3s into the track, restart it instead of going back.
    if (el && el.currentTime > 3) {
      el.currentTime = 0
      return
    }
    setCurrentIndex((i) => {
      if (i > 0) {
        playRequested.current = true
        return i - 1
      }
      return i
    })
  }, [setCurrentIndex])

  const togglePlay = useCallback(() => {
    const el = audioRef.current
    if (!el || currentIndex < 0) return
    if (el.paused) {
      el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [currentIndex])

  const toggleRepeat = useCallback(() => setRepeatOne((r) => !r), [setRepeatOne])

  const seek = useCallback((t) => {
    const el = audioRef.current
    if (el && Number.isFinite(t)) el.currentTime = t
  }, [])

  const removeAt = useCallback(
    (index) => {
      setQueue((prev) => {
        const nextQueue = prev.filter((_, i) => i !== index)
        setCurrentIndex((ci) => {
          if (nextQueue.length === 0) return -1
          if (index < ci) return ci - 1
          if (index === ci) {
            // Removed the current track: keep the same slot (now the next track),
            // clamped to the new bounds, and request playback of it.
            playRequested.current = true
            return Math.min(ci, nextQueue.length - 1)
          }
          return ci
        })
        return nextQueue
      })
    },
    [setQueue, setCurrentIndex]
  )

  const jumpTo = useCallback(
    (index) => {
      if (index < 0 || index >= queue.length) return
      playRequested.current = true
      setCurrentIndex(index)
    },
    [queue.length, setCurrentIndex]
  )

  // Reorder the queue by moving the track at `from` to `to`, keeping the
  // currently-playing track selected (no remove/re-add, so playback continues).
  const moveTrack = useCallback(
    (from, to) => {
      setQueue((prev) => {
        if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length)
          return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        // Keep currentIndex pointing at the same (still-playing) track.
        setCurrentIndex((ci) => {
          if (ci === from) return to
          // A track moved across the current slot shifts it by one.
          if (from < ci && to >= ci) return ci - 1
          if (from > ci && to <= ci) return ci + 1
          return ci
        })
        return next
      })
    },
    [setQueue, setCurrentIndex]
  )

  const clear = useCallback(() => {
    const el = audioRef.current
    if (el) el.pause()
    setQueue([])
    setCurrentIndex(-1)
    setIsPlaying(false)
    setExpanded(false)
  }, [setQueue, setCurrentIndex])

  const toggleExpanded = useCallback(() => setExpanded((e) => !e), [])

  const isCurrent = useCallback((id) => currentTrack?.id === id, [currentTrack])
  const isPlayingId = useCallback(
    (id) => isPlaying && currentTrack?.id === id,
    [isPlaying, currentTrack]
  )

  // If the persisted index points past the end of a (restored) queue, reset it.
  useEffect(() => {
    if (currentIndex >= queue.length) setCurrentIndex(queue.length - 1)
  }, [queue.length, currentIndex, setCurrentIndex])

  // Lazily hydrate queue entries that were added with only an id (campaign
  // resources, note embeds) so the player/queue show title + artwork. Each id is
  // fetched at most once; results patch every matching entry still in the queue.
  const hydratingIds = useRef(new Set())
  useEffect(() => {
    const pending = queue.filter((t) => needsHydration(t) && !hydratingIds.current.has(t.id))
    if (pending.length === 0) return
    const ids = [...new Set(pending.map((t) => t.id))]
    ids.forEach((id) => hydratingIds.current.add(id))
    ids.forEach((id) => {
      api
        .get(`/audio/${id}`)
        .then((data) => {
          setQueue((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    title: t.title || data.title || data.filename,
                    artist: t.artist || data.artist || '',
                    artwork: t.artwork || !!data.has_artwork,
                    _hydrated: true,
                  }
                : t
            )
          )
        })
        .catch(() => {
          // Mark resolved-with-no-metadata so we don't keep retrying a bad id.
          setQueue((prev) => prev.map((t) => (t.id === id ? { ...t, _hydrated: true } : t)))
        })
        .finally(() => {
          hydratingIds.current.delete(id)
        })
    })
  }, [queue, setQueue])

  const value = {
    audioRef,
    playRequested,
    queue,
    currentIndex,
    currentTrack,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    repeatOne,
    expanded,
    // actions
    playQueue,
    playNext,
    addToQueue,
    next,
    prev,
    togglePlay,
    toggleRepeat,
    seek,
    removeAt,
    jumpTo,
    moveTrack,
    clear,
    toggleExpanded,
    // selectors
    isCurrent,
    isPlayingId,
  }

  return <AudioPlayerContext.Provider value={value}>{children}</AudioPlayerContext.Provider>
}

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext)
  if (!ctx) {
    // A no-op fallback keeps controllers safe to render outside the provider
    // (e.g. in isolated component tests that don't wrap with the provider).
    return NOOP_PLAYER
  }
  return ctx
}

const NOOP = () => {}
const NOOP_PLAYER = {
  audioRef: { current: null },
  playRequested: { current: false },
  queue: [],
  currentIndex: -1,
  currentTrack: null,
  isPlaying: false,
  setIsPlaying: NOOP,
  currentTime: 0,
  setCurrentTime: NOOP,
  duration: 0,
  setDuration: NOOP,
  repeatOne: false,
  expanded: false,
  playQueue: NOOP,
  playNext: NOOP,
  addToQueue: NOOP,
  next: NOOP,
  prev: NOOP,
  togglePlay: NOOP,
  toggleRepeat: NOOP,
  seek: NOOP,
  removeAt: NOOP,
  jumpTo: NOOP,
  moveTrack: NOOP,
  clear: NOOP,
  toggleExpanded: NOOP,
  isCurrent: () => false,
  isPlayingId: () => false,
}
