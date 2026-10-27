import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useSavedFilters from './useSavedFilters'
import api from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

// The raw transport is generic over the URL; the tests only need its mocks.
const mockApi = vi.mocked(api) as unknown as Record<'get' | 'post' | 'patch' | 'delete', Mock>

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.get.mockResolvedValue({ filters: [] })
  mockApi.post.mockResolvedValue({ id: 'new' })
  mockApi.patch.mockResolvedValue({})
  mockApi.delete.mockResolvedValue({})
})

describe('useSavedFilters', () => {
  it('loads presets for its scope on mount', async () => {
    mockApi.get.mockResolvedValue({
      filters: [
        { id: 'a', name: 'F', state: { sort: 'year' }, is_default: true, scope: 'systems' },
      ],
    })
    const { result } = renderHook(() => useSavedFilters('systems'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(api.get).toHaveBeenCalledWith('/saved-filters?scope=systems')
    expect(result.current.saved).toHaveLength(1)
    expect(result.current.defaultFilter?.id).toBe('a')
  })

  it('degrades to an empty list on failure but still marks loaded', async () => {
    mockApi.get.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSavedFilters('systems'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.saved).toEqual([])
    expect(result.current.defaultFilter).toBeNull()
  })

  it('saves a preset and reloads', async () => {
    const { result } = renderHook(() => useSavedFilters('systems'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      await result.current.save('My filter', { sort: 'year' }, { asDefault: true })
    })
    expect(api.post).toHaveBeenCalledWith('/saved-filters', {
      scope: 'systems',
      name: 'My filter',
      state: { sort: 'year' },
      is_default: true,
    })
    // Reloaded after save.
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('ignores blank names without calling the API', async () => {
    const { result } = renderHook(() => useSavedFilters('systems'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      await result.current.save('   ', { sort: 'year' })
    })
    expect(api.post).not.toHaveBeenCalled()
  })

  it('sets a preset as default via PATCH', async () => {
    const { result } = renderHook(() => useSavedFilters('systems'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      await result.current.setDefault('a', true)
    })
    expect(api.patch).toHaveBeenCalledWith('/saved-filters/a', { is_default: true })
  })

  it('removes a preset via DELETE', async () => {
    const { result } = renderHook(() => useSavedFilters('systems'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      await result.current.remove('a')
    })
    expect(api.delete).toHaveBeenCalledWith('/saved-filters/a')
  })
})
