import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useAudioSets from './useAudioSets'
import api from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const ready = async () => {
  const { result } = renderHook(() => useAudioSets())
  await waitFor(() => expect(result.current.loading).toBe(false))
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ sets: [] })
  api.post.mockResolvedValue({ id: 'new' })
  api.patch.mockResolvedValue({ id: 'a' })
  api.delete.mockResolvedValue({})
})

describe('useAudioSets', () => {
  it('lists the user’s sets on mount', async () => {
    api.get.mockResolvedValue({
      sets: [{ id: 'a', kind: 'playlist', name: 'Storm', count: 2, layout: null }],
    })
    const result = await ready()
    expect(api.get).toHaveBeenCalledWith('/audio-sets')
    expect(result.current.sets).toHaveLength(1)
  })

  it('degrades to an empty list on failure but stops loading', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    const result = await ready()
    expect(result.current.sets).toEqual([])
  })

  it('saves a playlist and reloads the list', async () => {
    const result = await ready()
    await act(async () => {
      await result.current.save('playlist', 'Storm', [{ audio_id: 'x' }])
    })
    expect(api.post).toHaveBeenCalledWith('/audio-sets', {
      kind: 'playlist',
      name: 'Storm',
      entries: [{ audio_id: 'x' }],
    })
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('sends a layout only when one is given', async () => {
    const result = await ready()
    await act(async () => {
      await result.current.save('soundboard', 'Tavern', [], { cols: 3, rows: 5 })
    })
    expect(api.post).toHaveBeenCalledWith('/audio-sets', {
      kind: 'soundboard',
      name: 'Tavern',
      entries: [],
      layout: { cols: 3, rows: 5 },
    })
  })

  it('trims the name and refuses a blank one without calling the API', async () => {
    const result = await ready()
    await act(async () => {
      await result.current.save('playlist', '  Padded  ', [])
    })
    expect(api.post).toHaveBeenCalledWith(
      '/audio-sets',
      expect.objectContaining({ name: 'Padded' })
    )

    api.post.mockClear()
    let returned
    await act(async () => {
      returned = await result.current.save('playlist', '   ', [])
    })
    expect(api.post).not.toHaveBeenCalled()
    expect(returned).toBeNull()
  })

  it('surfaces a save failure as an error rather than throwing', async () => {
    api.post.mockRejectedValue(new Error('name taken'))
    const result = await ready()
    let returned
    await act(async () => {
      returned = await result.current.save('playlist', 'Storm', [])
    })
    expect(returned).toBeNull()
    expect(result.current.error).toBe('name taken')
  })

  it('clears a previous error on the next save', async () => {
    api.post.mockRejectedValueOnce(new Error('nope'))
    const result = await ready()
    await act(async () => {
      await result.current.save('playlist', 'A', [])
    })
    expect(result.current.error).toBe('nope')
    await act(async () => {
      await result.current.save('playlist', 'B', [])
    })
    expect(result.current.error).toBeNull()
  })

  it('loads one set without swallowing a failure', async () => {
    api.get.mockResolvedValue({ sets: [] })
    const result = await ready()

    api.get.mockResolvedValueOnce({ id: 'a', entries: [{ audio_id: 'x' }], missing: 1 })
    const full = await result.current.load('a')
    expect(api.get).toHaveBeenCalledWith('/audio-sets/a')
    expect(full.missing).toBe(1)

    // The caller needs the rejection so it can leave the live queue alone.
    api.get.mockRejectedValueOnce(new Error('gone'))
    await expect(result.current.load('a')).rejects.toThrow('gone')
  })

  it('renames and reloads', async () => {
    const result = await ready()
    await act(async () => {
      await result.current.rename('a', ' New ')
    })
    expect(api.patch).toHaveBeenCalledWith('/audio-sets/a', { name: 'New' })
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('refuses a blank rename', async () => {
    const result = await ready()
    let returned
    await act(async () => {
      returned = await result.current.rename('a', '  ')
    })
    expect(api.patch).not.toHaveBeenCalled()
    expect(returned).toBeNull()
  })

  it('surfaces a rename conflict', async () => {
    api.patch.mockRejectedValue(new Error('A set with that name already exists'))
    const result = await ready()
    await act(async () => {
      await result.current.rename('a', 'Taken')
    })
    expect(result.current.error).toBe('A set with that name already exists')
  })

  it('deletes and reloads', async () => {
    const result = await ready()
    await act(async () => {
      await result.current.remove('a')
    })
    expect(api.delete).toHaveBeenCalledWith('/audio-sets/a')
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('surfaces a delete failure', async () => {
    api.delete.mockRejectedValue(new Error('boom'))
    const result = await ready()
    await act(async () => {
      await result.current.remove('a')
    })
    expect(result.current.error).toBe('boom')
  })

  it('falls back to a generic message when the error carries none', async () => {
    api.post.mockRejectedValue({})
    api.patch.mockRejectedValue({})
    api.delete.mockRejectedValue({})
    const result = await ready()
    await act(async () => {
      await result.current.save('playlist', 'A', [])
    })
    expect(result.current.error).toBe('save failed')
    await act(async () => {
      await result.current.rename('a', 'B')
    })
    expect(result.current.error).toBe('rename failed')
    await act(async () => {
      await result.current.remove('a')
    })
    expect(result.current.error).toBe('delete failed')
  })

  it('exposes a manual refresh', async () => {
    const result = await ready()
    await act(async () => {
      await result.current.refresh()
    })
    expect(api.get).toHaveBeenCalledTimes(2)
  })
})
