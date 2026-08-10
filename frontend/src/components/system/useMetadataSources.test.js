import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import useMetadataSources, { clearMetadataSourcesCache } from './useMetadataSources'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
}))

const SOURCES = [{ id: 'ttrpg-wiki', name: 'TTRPG Wiki' }]

beforeEach(() => {
  vi.clearAllMocks()
  clearMetadataSourcesCache()
  api.get.mockResolvedValue({ sources: SOURCES })
})

describe('useMetadataSources', () => {
  it('loads the sources for a kind', async () => {
    const { result } = renderHook(() => useMetadataSources('systems', 'sys-1'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sources).toEqual(SOURCES)
    expect(api.get).toHaveBeenCalledWith('/systems/sys-1/metadata-sources')
  })

  it('treats a missing sources key as an empty list', async () => {
    api.get.mockResolvedValue({})
    const { result } = renderHook(() => useMetadataSources('systems', 'sys-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.sources).toEqual([])
  })

  // The whole point of the hook: bulk edit pages through dozens of resources of
  // the same kind, and the answer is identical for every one of them.
  it('asks the server only once per kind, whatever the resource', async () => {
    const first = renderHook(() => useMetadataSources('systems', 'sys-1'))
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    renderHook(() => useMetadataSources('systems', 'sys-2'))
    renderHook(() => useMetadataSources('systems', 'sys-3'))

    expect(api.get).toHaveBeenCalledTimes(1)
  })

  // A late-arriving answer is what made the "Fetch metadata" button pop in and
  // the "no scrapers installed" note flash; a warm cache must skip both.
  it('serves a warm cache on the first render, without loading', async () => {
    const first = renderHook(() => useMetadataSources('systems', 'sys-1'))
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    const second = renderHook(() => useMetadataSources('systems', 'sys-2'))
    expect(second.result.current.loading).toBe(false)
    expect(second.result.current.sources).toEqual(SOURCES)
  })

  it('keeps books and systems in separate cache entries', async () => {
    const systems = renderHook(() => useMetadataSources('systems', 'sys-1'))
    await waitFor(() => expect(systems.result.current.loading).toBe(false))

    const books = renderHook(() => useMetadataSources('books', 'book-1'))
    await waitFor(() => expect(books.result.current.loading).toBe(false))

    expect(api.get).toHaveBeenCalledTimes(2)
    expect(api.get).toHaveBeenCalledWith('/books/book-1/metadata-sources')
  })

  it('shares one in-flight request between editors mounting together', async () => {
    const a = renderHook(() => useMetadataSources('systems', 'sys-1'))
    const b = renderHook(() => useMetadataSources('systems', 'sys-2'))

    await waitFor(() => expect(a.result.current.loading).toBe(false))
    await waitFor(() => expect(b.result.current.loading).toBe(false))

    expect(api.get).toHaveBeenCalledTimes(1)
    expect(b.result.current.sources).toEqual(SOURCES)
  })

  it('reports a failure instead of hanging on loading', async () => {
    api.get.mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useMetadataSources('systems', 'sys-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('nope')
    expect(result.current.sources).toEqual([])
  })

  // An offline blip must not disable the feature for the rest of the session.
  it('does not cache a failure', async () => {
    api.get.mockRejectedValue(new Error('nope'))
    const failed = renderHook(() => useMetadataSources('systems', 'sys-1'))
    await waitFor(() => expect(failed.result.current.loading).toBe(false))

    api.get.mockResolvedValue({ sources: SOURCES })
    const retried = renderHook(() => useMetadataSources('systems', 'sys-1'))
    await waitFor(() => expect(retried.result.current.sources).toEqual(SOURCES))
  })

  it('stays idle without a kind or a sample id', () => {
    const { result } = renderHook(() => useMetadataSources('systems', null))

    expect(result.current.loading).toBe(false)
    expect(result.current.sources).toEqual([])
    expect(api.get).not.toHaveBeenCalled()
  })

  it('refetches after the cache is cleared, as on add-on install', async () => {
    const first = renderHook(() => useMetadataSources('systems', 'sys-1'))
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    clearMetadataSourcesCache()
    const second = renderHook(() => useMetadataSources('systems', 'sys-1'))
    await waitFor(() => expect(second.result.current.loading).toBe(false))

    expect(api.get).toHaveBeenCalledTimes(2)
  })
})
