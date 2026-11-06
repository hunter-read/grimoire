import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import usePins from './usePins'
import api from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

const mockApi = vi.mocked(api) as unknown as Record<'get' | 'post' | 'delete', Mock>
const PIN = { id: 'p1', collection: 'maps', target: 'Czepeku/Night' }

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.get.mockResolvedValue({ pins: [PIN] })
  mockApi.post.mockResolvedValue({ id: 'p2', collection: 'maps', target: 'Tom Cartos' })
  mockApi.delete.mockResolvedValue(null)
})

describe('usePins', () => {
  it('loads the view’s pins', async () => {
    const { result } = renderHook(() => usePins('maps'))
    await waitFor(() => expect(result.current.pins).toEqual([PIN]))
    expect(api.get).toHaveBeenCalledWith('/pins?collection=maps')
    expect(result.current.isPinned('Czepeku/Night')).toBe(true)
    expect(result.current.isPinned('Elsewhere')).toBe(false)
  })

  it('starts empty when the pins cannot be loaded', async () => {
    mockApi.get.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => usePins('maps'))
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(result.current.pins).toEqual([])
  })

  it('pins something new', async () => {
    const { result } = renderHook(() => usePins('maps'))
    await waitFor(() => expect(result.current.pins).toHaveLength(1))
    await act(() => result.current.toggle('Tom Cartos'))
    expect(api.post).toHaveBeenCalledWith('/pins', { collection: 'maps', target: 'Tom Cartos' })
    expect(result.current.isPinned('Tom Cartos')).toBe(true)
  })

  it('leaves the strip alone when pinning fails', async () => {
    mockApi.post.mockRejectedValue(new Error('full'))
    const { result } = renderHook(() => usePins('maps'))
    await waitFor(() => expect(result.current.pins).toHaveLength(1))
    await act(() => result.current.toggle('Tom Cartos'))
    expect(result.current.pins).toEqual([PIN])
  })

  it('unpins at once, and puts the pin back if the server refuses', async () => {
    const { result } = renderHook(() => usePins('maps'))
    await waitFor(() => expect(result.current.pins).toHaveLength(1))
    await act(() => result.current.toggle('Czepeku/Night'))
    expect(api.delete).toHaveBeenCalledWith('/pins/p1')
    expect(result.current.pins).toEqual([])

    mockApi.get.mockResolvedValue({ pins: [PIN] })
    const again = renderHook(() => usePins('maps'))
    await waitFor(() => expect(again.result.current.pins).toHaveLength(1))
    mockApi.delete.mockRejectedValue(new Error('down'))
    await act(() => again.result.current.toggle('Czepeku/Night'))
    expect(again.result.current.pins).toEqual([PIN])
  })
})
