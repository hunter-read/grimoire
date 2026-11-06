import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import usePagedLists from './usePagedLists'

// A fake endpoint over `rows`, recording each request.
function endpoint<T>(rows: T[]) {
  const calls: { key: string; offset: number; limit: number }[] = []
  const fetchPage = vi.fn((key: string, offset: number, limit: number) => {
    calls.push({ key, offset, limit })
    return Promise.resolve({ total: rows.length, rows: rows.slice(offset, offset + limit) })
  })
  return { fetchPage, calls }
}

const ROWS: { id: string; seen?: boolean }[] = Array.from({ length: 5 }, (_, i) => ({
  id: `r${i}`,
}))

describe('usePagedLists', () => {
  it('loads a list a page at a time and stops at the end', async () => {
    const { fetchPage, calls } = endpoint(ROWS)
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 2 }))
    expect(result.current.get('a')).toBeUndefined()

    act(() => result.current.ensure('a'))
    await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(2))
    expect(result.current.get('a')!.hasMore).toBe(true)

    act(() => result.current.loadMore('a'))
    await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(4))
    act(() => result.current.loadMore('a'))
    await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(5))
    expect(result.current.get('a')!.hasMore).toBe(false)

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
    await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(2))
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('keeps separate lists per key', async () => {
    const { fetchPage } = endpoint(ROWS)
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 3 }))
    act(() => {
      result.current.ensure('a')
      result.current.ensure('b')
    })
    await waitFor(() => expect(result.current.get('b')!.items).toHaveLength(3))
    expect(Object.keys(result.current.lists).sort()).toEqual(['a', 'b'])
  })

  it('drops every list, and ignores stale responses, when the reset key changes', async () => {
    let release: () => void
    const fetchPage = vi.fn(
      () =>
        new Promise<{ total: number; rows: { id: string }[] }>((resolve) => {
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
    await waitFor(() => expect(result.current.get('a')!.error).toBeTruthy())
    act(() => result.current.loadMore('a'))
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('rewrites loaded items in place', async () => {
    const { fetchPage } = endpoint(ROWS)
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 2 }))
    act(() => result.current.ensure('a'))
    await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(2))
    act(() => result.current.mapItems((r) => ({ ...r, seen: true })))
    expect(result.current.get('a')!.items.every((r) => r.seen)).toBe(true)
  })

  it('drops removed items and shrinks the total to match', async () => {
    const { fetchPage } = endpoint(ROWS)
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 2 }))
    act(() => result.current.ensure('a'))
    await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(2))
    act(() => result.current.removeItems((r) => r.id === 'r0'))
    expect(result.current.get('a')!.items.map((r) => r.id)).toEqual(['r1'])
    // Four rows remain on the server, so the list still has more to load.
    expect(result.current.get('a')!.total).toBe(4)
    expect(result.current.get('a')!.hasMore).toBe(true)
  })

  it('asks for a smaller first page, then full pages', async () => {
    const { fetchPage, calls } = endpoint(Array.from({ length: 300 }, (_, i) => ({ id: i })))
    const { result } = renderHook(() => usePagedLists(fetchPage, 'k'))
    act(() => result.current.ensure('a'))
    await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(60))
    act(() => result.current.loadMore('a'))
    await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(260))
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

  describe('opening part-way (a jump rail)', () => {
    const MANY = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}` }))

    it('reopens a list at an offset without loading what is before it', async () => {
      const { fetchPage, calls } = endpoint(MANY)
      const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 3 }))
      act(() => result.current.ensure('a'))
      await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(3))

      act(() => result.current.jumpTo('a', 7))
      await waitFor(() =>
        expect(result.current.get('a')!.items.map((r) => r.id)).toEqual(['r7', 'r8', 'r9'])
      )
      const list = result.current.get('a')!
      expect(list).toMatchObject({ start: 7, hasEarlier: true, hasMore: true })
      expect(calls.at(-1)).toMatchObject({ offset: 7, limit: 3 })

      // Paging on continues from where the list now ends.
      act(() => result.current.loadMore('a'))
      await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(5))
      expect(result.current.get('a')!.hasMore).toBe(false)
    })

    it('loads the rows before a reopened list, a page at a time', async () => {
      const { fetchPage, calls } = endpoint(MANY)
      const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 3 }))
      act(() => result.current.jumpTo('a', 4))
      await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(3))

      act(() => result.current.loadEarlier('a'))
      await waitFor(() => expect(result.current.get('a')!.start).toBe(1))
      expect(
        result.current
          .get('a')!
          .items.map((r) => r.id)
          .slice(0, 4)
      ).toEqual(['r1', 'r2', 'r3', 'r4'])
      expect(calls.at(-1)).toMatchObject({ offset: 1, limit: 3 })

      act(() => result.current.loadEarlier('a'))
      await waitFor(() => expect(result.current.get('a')!.start).toBe(0))
      expect(result.current.get('a')!.hasEarlier).toBe(false)
      expect(calls.at(-1)).toMatchObject({ offset: 0, limit: 1 })

      // Nothing before the start: no request.
      const before = calls.length
      act(() => result.current.loadEarlier('a'))
      act(() => result.current.loadEarlier('missing'))
      expect(calls).toHaveLength(before)
    })

    it('drops a page still in flight for the old position', async () => {
      let resolve: (v: { total: number; rows: { id: string }[] }) => void = () => {}
      const fetchPage = vi.fn((_key: string, offset: number) =>
        offset === 0
          ? new Promise<{ total: number; rows: { id: string }[] }>((r) => {
              resolve = r
            })
          : Promise.resolve({ total: 12, rows: [{ id: `r${offset}` }] })
      )
      const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 1 }))
      act(() => result.current.ensure('a'))
      act(() => result.current.jumpTo('a', 9))
      await waitFor(() => expect(result.current.get('a')!.items.map((r) => r.id)).toEqual(['r9']))
      await act(async () => resolve({ total: 12, rows: [{ id: 'r0' }] }))
      expect(result.current.get('a')!.items.map((r) => r.id)).toEqual(['r9'])
    })

    it('keeps the earlier rows on a failed load and reports the error', async () => {
      const fetchPage = vi.fn((_key: string, offset: number) =>
        offset === 5
          ? Promise.resolve({ total: 10, rows: [{ id: 'r5' }] })
          : Promise.reject(new Error('down'))
      )
      const { result } = renderHook(() => usePagedLists(fetchPage, 'k', { pageSize: 1 }))
      act(() => result.current.jumpTo('a', 5))
      await waitFor(() => expect(result.current.get('a')!.items).toHaveLength(1))
      act(() => result.current.loadEarlier('a'))
      await waitFor(() => expect(result.current.get('a')!.error).toBeTruthy())
      expect(result.current.get('a')).toMatchObject({ start: 5, loading: false })
    })
  })
})
