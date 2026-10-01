import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useScanStatus from './useScanStatus'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../api'

beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue({ running: false, phase: null })
  api.post.mockResolvedValue({})
})

describe('useScanStatus', () => {
  it('tells every other instance on screen when a scan starts', async () => {
    const a = renderHook(() => useScanStatus())
    const b = renderHook(() => useScanStatus())
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    // The backend reports the scan as running from the moment /rescan returns.
    api.post.mockImplementation(async () => {
      api.get.mockResolvedValue({ running: true, phase: 'scanning' })
      return {}
    })

    await act(() => a.result.current.startRescan({ metadata_mode: 'all' }))

    expect(api.post).toHaveBeenCalledWith('/rescan', { scope: null, metadata_mode: 'all' })
    expect(b.result.current.status.running).toBe(true)
    expect(b.result.current.status.phase).toBe('scanning')
  })

  it('does not announce a scan whose request failed', async () => {
    api.post.mockRejectedValue(new Error('busy'))
    const a = renderHook(() => useScanStatus())
    const b = renderHook(() => useScanStatus())

    await act(() => a.result.current.startRescan().catch(() => {}))

    expect(a.result.current.status.running).toBe(false)
    expect(b.result.current.status.running).toBe(false)
  })

  it('records the last result once a scan that found something finishes', async () => {
    api.get.mockResolvedValue({
      running: false,
      phase: null,
      new_books: 2,
      new_maps: 0,
      new_tokens: 0,
      indexed: 0,
    })
    const { result } = renderHook(() => useScanStatus())
    await waitFor(() => expect(result.current.lastResult?.new_books).toBe(2))
  })

  it('marks itself stopping when a scan is cancelled', async () => {
    const { result } = renderHook(() => useScanStatus())
    await act(() => result.current.stopScan())
    expect(api.post).toHaveBeenCalledWith('/cancel-scan')
    expect(result.current.stopping).toBe(true)
  })
})
