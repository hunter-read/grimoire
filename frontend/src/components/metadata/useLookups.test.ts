import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import useLookups from './useLookups'
import api from '../../api'

vi.mock('../../api', () => ({ default: { get: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((path) => {
    if (path.includes('genres')) return Promise.resolve({ genres: [{ id: 'g' }] })
    if (path.includes('system-families')) return Promise.resolve({ families: [{ id: 'f' }] })
    if (path.includes('parent-systems')) return Promise.resolve({ parent_systems: [{ id: 'p' }] })
    if (path.includes('licenses')) return Promise.resolve({ licenses: [{ id: 'l' }] })
    if (path.includes('dice-materials')) return Promise.resolve({ dice_materials: [{ id: 'd' }] })
    return Promise.resolve({})
  })
})

// Number of lookup endpoints fetched on each load.
const ENDPOINT_COUNT = 5

describe('useLookups', () => {
  it('loads every lookup list on mount', async () => {
    const { result } = renderHook(() => useLookups())
    await waitFor(() => expect(result.current.genres).toHaveLength(1))
    expect(result.current.families).toHaveLength(1)
    expect(result.current.parentSystems).toHaveLength(1)
    expect(result.current.licenses).toHaveLength(1)
    expect(result.current.diceMaterials).toHaveLength(1)
  })

  it('degrades to empty lists on failure', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useLookups())
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(result.current.genres).toEqual([])
    expect(result.current.families).toEqual([])
    expect(result.current.parentSystems).toEqual([])
    expect(result.current.licenses).toEqual([])
    expect(result.current.diceMaterials).toEqual([])
  })

  it('reload re-fetches every list', async () => {
    const { result } = renderHook(() => useLookups())
    await waitFor(() => expect(result.current.genres).toHaveLength(1))
    api.get.mockClear()
    act(() => result.current.reload())
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(ENDPOINT_COUNT))
  })
})
