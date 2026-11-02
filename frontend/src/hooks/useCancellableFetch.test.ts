import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import api from '../api'
import useCancellableFetch from './useCancellableFetch'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const get = vi.mocked(api.get)

beforeEach(() => vi.clearAllMocks())

describe('useCancellableFetch', () => {
  it('loads the URL it is given', async () => {
    get.mockResolvedValue({ id: 'one' })
    const { result } = renderHook(() => useCancellableFetch<{ id: string }>('/things/one'))
    expect(result.current.data).toBeNull()
    await waitFor(() => expect(result.current.data).toEqual({ id: 'one' }))
    expect(get).toHaveBeenCalledWith('/things/one')
  })

  it('drops a response for a URL it has moved on from', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    get.mockImplementation((url: string) =>
      url === '/things/one'
        ? new Promise((resolve) => (resolveFirst = resolve))
        : Promise.resolve({ id: 'two' })
    )
    const { result, rerender } = renderHook(({ url }) => useCancellableFetch(url), {
      initialProps: { url: '/things/one' },
    })
    rerender({ url: '/things/two' })
    await waitFor(() => expect(result.current.data).toEqual({ id: 'two' }))
    await act(async () => resolveFirst({ id: 'one' }))
    expect(result.current.data).toEqual({ id: 'two' })
  })

  it('reports a 404 as not found', async () => {
    get.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }))
    const { result } = renderHook(() => useCancellableFetch('/things/gone'))
    await waitFor(() =>
      expect(result.current.error).toEqual({ message: 'Not found', notFound: true })
    )
    expect(result.current.data).toBeNull()
  })

  it('ignores a failure for a URL it has moved on from', async () => {
    let rejectFirst: (e: Error) => void = () => {}
    get.mockImplementation((url: string) =>
      url === '/things/one'
        ? new Promise((_, reject) => (rejectFirst = reject))
        : Promise.resolve({ id: 'two' })
    )
    const { result, rerender } = renderHook(({ url }) => useCancellableFetch(url), {
      initialProps: { url: '/things/one' },
    })
    rerender({ url: '/things/two' })
    await waitFor(() => expect(result.current.data).toEqual({ id: 'two' }))
    await act(async () => rejectFirst(new Error('late')))
    expect(result.current.error).toBeNull()
  })

  it('tries again on reload, clearing the error', async () => {
    get.mockRejectedValueOnce(new Error('Server error')).mockResolvedValueOnce({ id: 'one' })
    const { result } = renderHook(() => useCancellableFetch('/things/one'))
    await waitFor(() =>
      expect(result.current.error).toEqual({ message: 'Server error', notFound: false })
    )
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.data).toEqual({ id: 'one' }))
    expect(result.current.error).toBeNull()
  })

  it('fetches nothing for a null URL', () => {
    const { result } = renderHook(() => useCancellableFetch(null))
    expect(get).not.toHaveBeenCalled()
    expect(result.current.data).toBeNull()
  })

  it('lets the caller replace the data after an edit', async () => {
    get.mockResolvedValue({ id: 'one', name: 'Old' })
    const { result } = renderHook(() =>
      useCancellableFetch<{ id: string; name: string }>('/things/one')
    )
    await waitFor(() => expect(result.current.data?.name).toBe('Old'))
    act(() => result.current.setData((d) => (d ? { ...d, name: 'New' } : d)))
    expect(result.current.data?.name).toBe('New')
  })
})
