import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AudioPlayerProvider, useAudioPlayer } from './AudioPlayerContext'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const wrapper = ({ children }) => <AudioPlayerProvider>{children}</AudioPlayerProvider>

const tracks = (...ids) => ids.map((id) => ({ id, title: `Track ${id}` }))

describe('AudioPlayerContext', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
    api.get.mockResolvedValue({})
  })

  it('playQueue replaces the queue and starts at index 0', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a', 'b', 'c')))
    expect(result.current.queue.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(result.current.currentIndex).toBe(0)
    expect(result.current.currentTrack.id).toBe('a')
  })

  it('playQueue can start at a given index', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a', 'b', 'c'), 2))
    expect(result.current.currentIndex).toBe(2)
    expect(result.current.currentTrack.id).toBe('c')
  })

  it('playQueue ignores empty / invalid input', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue([]))
    act(() => result.current.playQueue([{ title: 'no id' }]))
    expect(result.current.queue).toEqual([])
    expect(result.current.currentIndex).toBe(-1)
  })

  it('playNext inserts right after the current track', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a', 'b', 'c')))
    act(() => result.current.playNext({ id: 'x', title: 'X' }))
    expect(result.current.queue.map((t) => t.id)).toEqual(['a', 'x', 'b', 'c'])
    // current track unchanged
    expect(result.current.currentTrack.id).toBe('a')
  })

  it('playNext on an empty queue starts playing the track', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playNext({ id: 'solo' }))
    expect(result.current.queue.map((t) => t.id)).toEqual(['solo'])
    expect(result.current.currentIndex).toBe(0)
  })

  it('addToQueue appends to the end', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a')))
    act(() => result.current.addToQueue({ id: 'b' }))
    expect(result.current.queue.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('next advances and stops at the end of the queue', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a', 'b')))
    act(() => result.current.next())
    expect(result.current.currentIndex).toBe(1)
    act(() => result.current.next())
    // No repeat-all: clamps at the last index.
    expect(result.current.currentIndex).toBe(1)
  })

  it('jumpTo selects a queue position', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a', 'b', 'c')))
    act(() => result.current.jumpTo(2))
    expect(result.current.currentTrack.id).toBe('c')
  })

  it('removeAt before current shifts the index down', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a', 'b', 'c'), 2))
    act(() => result.current.removeAt(0))
    expect(result.current.queue.map((t) => t.id)).toEqual(['b', 'c'])
    expect(result.current.currentTrack.id).toBe('c')
  })

  it('removeAt the current track advances to the next in its slot', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a', 'b', 'c'), 1))
    act(() => result.current.removeAt(1))
    expect(result.current.queue.map((t) => t.id)).toEqual(['a', 'c'])
    // Same slot, now holding 'c'.
    expect(result.current.currentTrack.id).toBe('c')
  })

  it('toggleRepeat flips repeatOne', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    expect(result.current.repeatOne).toBe(false)
    act(() => result.current.toggleRepeat())
    expect(result.current.repeatOne).toBe(true)
  })

  it('clear empties the queue', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a', 'b')))
    act(() => result.current.clear())
    expect(result.current.queue).toEqual([])
    expect(result.current.currentIndex).toBe(-1)
    expect(result.current.currentTrack).toBe(null)
  })

  it('isCurrent / isPlayingId reflect the active track', () => {
    const { result } = renderHook(() => useAudioPlayer(), { wrapper })
    act(() => result.current.playQueue(tracks('a', 'b')))
    expect(result.current.isCurrent('a')).toBe(true)
    expect(result.current.isCurrent('b')).toBe(false)
    // isPlayingId requires isPlaying, which is driven by the <audio> element.
    expect(result.current.isPlayingId('a')).toBe(false)
  })

  describe('moveTrack', () => {
    it('reorders a track and keeps the current one selected', () => {
      const { result } = renderHook(() => useAudioPlayer(), { wrapper })
      act(() => result.current.playQueue(tracks('a', 'b', 'c'), 0))
      // Move 'c' (index 2) to the front (index 0); current 'a' shifts to index 1.
      act(() => result.current.moveTrack(2, 0))
      expect(result.current.queue.map((t) => t.id)).toEqual(['c', 'a', 'b'])
      expect(result.current.currentTrack.id).toBe('a')
    })

    it('moving the current track follows it', () => {
      const { result } = renderHook(() => useAudioPlayer(), { wrapper })
      act(() => result.current.playQueue(tracks('a', 'b', 'c'), 0))
      act(() => result.current.moveTrack(0, 2))
      expect(result.current.queue.map((t) => t.id)).toEqual(['b', 'c', 'a'])
      expect(result.current.currentTrack.id).toBe('a')
    })

    it('is a no-op for out-of-range or identical indices', () => {
      const { result } = renderHook(() => useAudioPlayer(), { wrapper })
      act(() => result.current.playQueue(tracks('a', 'b')))
      act(() => result.current.moveTrack(0, 0))
      act(() => result.current.moveTrack(0, 5))
      expect(result.current.queue.map((t) => t.id)).toEqual(['a', 'b'])
    })
  })

  describe('lazy hydration', () => {
    it('fetches metadata for id-only tracks and patches the queue', async () => {
      api.get.mockResolvedValue({
        title: 'Mystic Drone',
        artist: 'Bardcore',
        has_artwork: true,
      })
      const { result } = renderHook(() => useAudioPlayer(), { wrapper })
      act(() => result.current.playQueue([{ id: 'x1' }]))
      await waitFor(() => expect(result.current.queue[0].title).toBe('Mystic Drone'))
      expect(result.current.queue[0].artist).toBe('Bardcore')
      expect(result.current.queue[0].artwork).toBe(true)
      expect(api.get).toHaveBeenCalledWith('/audio/x1')
    })

    it('does not fetch tracks that already have a title', async () => {
      const { result } = renderHook(() => useAudioPlayer(), { wrapper })
      act(() => result.current.playQueue([{ id: 'y1', title: 'Already Set' }]))
      // Give any effect a tick.
      await waitFor(() => expect(result.current.queue.length).toBe(1))
      expect(api.get).not.toHaveBeenCalled()
    })

    it('marks a track resolved after a failed fetch so it is not retried', async () => {
      api.get.mockRejectedValue(new Error('boom'))
      const { result } = renderHook(() => useAudioPlayer(), { wrapper })
      act(() => result.current.playQueue([{ id: 'z1' }]))
      await waitFor(() => expect(result.current.queue[0]._hydrated).toBe(true))
      expect(api.get).toHaveBeenCalledTimes(1)
    })
  })
})
