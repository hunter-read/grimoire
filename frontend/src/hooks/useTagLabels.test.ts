import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import useTagLabels, { titleCaseTag } from './useTagLabels'

const mockList = vi.fn()
vi.mock('../api', () => ({
  tags: { list: (...a) => mockList(...a) },
}))

beforeEach(() => vi.clearAllMocks())

describe('titleCaseTag', () => {
  it('title-cases each word of an internal key', () => {
    expect(titleCaseTag('gm screen')).toBe('Gm Screen')
    expect(titleCaseTag('osr')).toBe('Osr')
  })
})

describe('useTagLabels', () => {
  it('returns an internal→display map for the resource type', async () => {
    mockList.mockResolvedValue({
      tags: [
        { internal: 'gm screen', display: 'GM Screen', count: 2 },
        { internal: 'osr', display: 'OSR', count: 1 },
      ],
    })
    const { result } = renderHook(() => useTagLabels('map'))
    await waitFor(() => expect(result.current['gm screen']).toBe('GM Screen'))
    expect(mockList).toHaveBeenCalledWith('map')
    expect(result.current.osr).toBe('OSR')
  })

  it('returns an empty map when no resource type is given (no fetch)', () => {
    const { result } = renderHook(() => useTagLabels(null))
    expect(result.current).toEqual({})
    expect(mockList).not.toHaveBeenCalled()
  })

  it('falls back to an empty map when the request fails', async () => {
    mockList.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTagLabels('book'))
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    expect(result.current).toEqual({})
  })
})
