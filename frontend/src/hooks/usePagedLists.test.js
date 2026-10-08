import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import usePagedLists from './usePagedLists'

// A fake endpoint over `rows`, recording each request.
function endpoint(rows) {
  const calls = []
  const fetchPage = vi.fn((key, offset, limit) => {
    calls.push({ key, offset, limit })
    return Promise.resolve({ total: rows.length, rows: rows.slice(offset, offset + limit) })
  })
  return { fetchPage, calls }
}

const ROWS = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }))

describe('usePagedLists', () => {
  it('loads a list a page at a time and stops at the end', async () => {
    const { fetchPage, calls } = endpoint(ROWS)
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 2 }))
    expect(result.current.get('a')).toBeUndefined()

    act(() => result.current.ensure('a'))
    await waitFor(() => expect(result.current.get('a').items).toHaveLength(2))
    expect(result.current.get('a').hasMore).toBe(true)

    act(() => result.current.loadMore('a'))
    await waitFor(() => expect(result.current.get('a').items).toHaveLength(4))
    act(() => result.current.loadMore('a'))
    await waitFor(() => expect(result.current.get('a').items).toHaveLength(5))
    expect(result.current.get('a').hasMore).toBe(false)

    act(() => result.current.loadMore('a'))
    expect(calls.map((c) => c.offset)).toEqual([0, 2, 4])
  })

  it('does not request a page twice while one is in flight', async () => {
    const { fetchPage } = endpoint(ROWS)
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 2 }))
    act(() => {
      result.current.ensure('a')
      result.current.ensure('a')
    })
    await waitFor(() => expect(result.current.get('a').items).toHaveLength(2))
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('keeps separate lists per key', async () => {
    const { fetchPage } = endpoint(ROWS)
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 3 }))
    act(() => {
      result.current.ensure('a')
      result.current.ensure('b')
    })
    await waitFor(() => expect(result.current.get('b').items).toHaveLength(3))
    expect(Object.keys(result.current.lists).sort()).toEqual(['a', 'b'])
  })

  it('drops every list, and ignores stale responses, when the reset key changes', async () => {
    let release
    const fetchPage = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ total: 1, rows: [{ id: 'stale' }] })
        })
    )
    const { result, rerender } = renderHook(({ k }) => usePagedLists(fetchPage, k), {
      initialProps: { k: 'one' },
    })
    act(() => result.current.ensure('a'))
    rerender({ k: 'two' })
    await act(async () => release())
    expect(result.current.get('a')).toBeUndefined()
  })

  it('records an error and stops paging that list', async () => {
    const fetchPage = vi.fn(() => Promise.reject(new Error('boom')))
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k'))
    act(() => result.current.ensure('a'))
    await waitFor(() => expect(result.current.get('a').error).toBeTruthy())
    act(() => result.current.loadMore('a'))
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('rewrites loaded items in place', async () => {
    const { fetchPage } = endpoint(ROWS)
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 2 }))
    act(() => result.current.ensure('a'))
    await waitFor(() => expect(result.current.get('a').items).toHaveLength(2))
    act(() => result.current.mapItems((r) => ({ ...r, seen: true })))
    expect(result.current.get('a').items.every((r) => r.seen)).toBe(true)
  })

  it('asks for a smaller first page, then full pages', async () => {
    const { fetchPage, calls } = endpoint(Array.from({ length: 300 }, (_, i) => ({ id: i })))
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k'))
    act(() => result.current.ensure('a'))
    await waitFor(() => expect(result.current.get('a').items).toHaveLength(60))
    act(() => result.current.loadMore('a'))
    await waitFor(() => expect(result.current.get('a').items).toHaveLength(260))
    expect(calls.map((c) => [c.offset, c.limit])).toEqual([
      [0, 60],
      [60, 200],
    ])
  })

  it('ignores loadMore for a list that has not started', () => {
    const { fetchPage } = endpoint(ROWS)
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k'))
    act(() => result.current.loadMore('a'))
    expect(fetchPage).not.toHaveBeenCalled()
  })
})
