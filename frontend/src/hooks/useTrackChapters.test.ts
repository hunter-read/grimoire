import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import api from '../api'
import useTrackChapters, {
  _clearChapterCache,
  chapterIndexAt,
  chapterLabel,
} from './useTrackChapters'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const CHAPTERS = [
  { start: 0, title: 'One' },
  { start: 10, title: '' },
]

beforeEach(() => {
  _clearChapterCache()
  api.get.mockReset()
})

describe('useTrackChapters', () => {
  it('returns nothing and fetches nothing without a track', () => {
    const { result } = renderHook(() => useTrackChapters(null))
    expect(result.current).toEqual([])
    expect(api.get).not.toHaveBeenCalled()
  })

  it("fetches a track's chapters once and reuses them", async () => {
    api.get.mockResolvedValue({ chapters: CHAPTERS })
    const { result, rerender } = renderHook(({ id }) => useTrackChapters(id), {
      initialProps: { id: 'book' },
    })
    expect(result.current).toEqual([])
    await waitFor(() => expect(result.current).toEqual(CHAPTERS))
    expect(api.get).toHaveBeenCalledWith('/audio/book/chapters')

    rerender({ id: 'other' })
    rerender({ id: 'book' })
    expect(result.current).toEqual(CHAPTERS)
    expect(api.get.mock.calls.filter(([url]) => url === '/audio/book/chapters')).toHaveLength(1)
  })

  it('treats a malformed response as no chapters', async () => {
    api.get.mockResolvedValue({})
    const { result } = renderHook(() => useTrackChapters('odd'))
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(result.current).toEqual([])
  })

  it('does not cache a failed request, so the track asks again later', async () => {
    api.get.mockRejectedValueOnce(new Error('offline'))
    const first = renderHook(() => useTrackChapters('flaky'))
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))
    expect(first.result.current).toEqual([])
    first.unmount()

    api.get.mockResolvedValue({ chapters: CHAPTERS })
    const second = renderHook(() => useTrackChapters('flaky'))
    await waitFor(() => expect(second.result.current).toEqual(CHAPTERS))
  })
})

describe('chapterIndexAt', () => {
  it('finds the last chapter started by the given time', () => {
    expect(chapterIndexAt(CHAPTERS, 0)).toBe(0)
    expect(chapterIndexAt(CHAPTERS, 9.9)).toBe(0)
    expect(chapterIndexAt(CHAPTERS, 10)).toBe(1)
    expect(chapterIndexAt(CHAPTERS, 500)).toBe(1)
  })

  it('is -1 before the first chapter or with none', () => {
    expect(chapterIndexAt([{ start: 5, title: 'Late' }], 1)).toBe(-1)
    expect(chapterIndexAt([], 1)).toBe(-1)
  })
})

describe('chapterLabel', () => {
  const t = (key, opts) => `${key}:${opts.n}`

  it("uses the chapter's title, else its number", () => {
    expect(chapterLabel(t, CHAPTERS, 0)).toBe('One')
    expect(chapterLabel(t, CHAPTERS, 1)).toBe('audio.player.chapterNumber:2')
  })
})
