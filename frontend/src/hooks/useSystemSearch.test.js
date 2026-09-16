import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useSystemSearch from './useSystemSearch'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const RESULTS = { books: [{ id: 'b1' }] }

const typeInto = (result, value) =>
  act(() => {
    result.current.handleSearchInput({ target: { value } })
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  sessionStorage.clear()
  api.get.mockResolvedValue(RESULTS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSystemSearch', () => {
  it('starts empty and searches nothing', () => {
    const { result } = renderHook(() => useSystemSearch('sys1', false))
    expect(result.current.searchQuery).toBe('')
    expect(result.current.searchResults).toBe(null)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('debounces the request rather than firing per keystroke', async () => {
    const { result } = renderHook(() => useSystemSearch('sys1', false))
    typeInto(result, 'dr')
    typeInto(result, 'dra')
    typeInto(result, 'drag')
    expect(api.get).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(350))
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledWith('/search?q=drag&system_id=sys1')
  })

  it('stores the results and clears the searching flag', async () => {
    vi.useRealTimers()
    const { result } = renderHook(() => useSystemSearch('sys1', false))
    typeInto(result, 'drag')
    await waitFor(() => expect(result.current.searchResults).toEqual(RESULTS))
    expect(result.current.searching).toBe(false)
  })

  // A single stray character should not cost a request.
  it('clears results instead of searching for a one-character query', () => {
    const { result } = renderHook(() => useSystemSearch('sys1', false))
    typeInto(result, 'd')
    act(() => vi.advanceTimersByTime(350))
    expect(api.get).not.toHaveBeenCalled()
    expect(result.current.searchResults).toBe(null)
  })

  it('url-encodes the query', () => {
    const { result } = renderHook(() => useSystemSearch('sys1', false))
    typeInto(result, 'a&b c')
    act(() => vi.advanceTimersByTime(350))
    expect(api.get).toHaveBeenCalledWith('/search?q=a%26b%20c&system_id=sys1')
  })

  it('keeps searching false when the request fails', async () => {
    vi.useRealTimers()
    api.get.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSystemSearch('sys1', false))
    typeInto(result, 'drag')
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    await waitFor(() => expect(result.current.searching).toBe(false))
    expect(result.current.searchResults).toBe(null)
  })

  it('clearSearch empties the box, the results, and any pending request', () => {
    const { result } = renderHook(() => useSystemSearch('sys1', false))
    typeInto(result, 'drag')
    act(() => {
      result.current.clearSearch()
    })
    act(() => vi.advanceTimersByTime(350))
    expect(result.current.searchQuery).toBe('')
    expect(result.current.searchResults).toBe(null)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('re-runs a restored query on mount when returning to the view', async () => {
    vi.useRealTimers()
    sessionStorage.setItem('grimoire:system:sys1:search-query', JSON.stringify('drag'))
    renderHook(() => useSystemSearch('sys1', true))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/search?q=drag&system_id=sys1'))
  })

  it('does not re-run a stored query on a fresh visit', () => {
    sessionStorage.setItem('grimoire:system:sys1:search-query', JSON.stringify('drag'))
    renderHook(() => useSystemSearch('sys1', false))
    expect(api.get).not.toHaveBeenCalled()
  })
})
