import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import useScanStatus, { SCAN_STARTED } from './useScanStatus'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../api'

// The transport is generic over the URL; the tests drive it as plain mocks.
const mockApi = vi.mocked(api) as unknown as Record<'get' | 'post', Mock>

beforeEach(() => {
  vi.resetAllMocks()
  mockApi.get.mockResolvedValue({ running: false, phase: null })
  mockApi.post.mockResolvedValue({})
})

describe('useScanStatus', () => {
  it('tells every other instance on screen when a scan starts', async () => {
    const a = renderHook(() => useScanStatus())
    const b = renderHook(() => useScanStatus())
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))
    // The backend reports the scan as running from the moment /rescan returns.
    mockApi.post.mockImplementation(async () => {
      mockApi.get.mockResolvedValue({ running: true, phase: 'scanning' })
      return {}
    })

    await act(() => a.result.current.startRescan({ metadata_mode: 'all' }))

    expect(api.post).toHaveBeenCalledWith('/rescan', { scope: null, metadata_mode: 'all' })
    expect(b.result.current.status.running).toBe(true)
    expect(b.result.current.status.phase).toBe('scanning')
  })

  it('does not announce a scan whose request failed', async () => {
    mockApi.post.mockRejectedValue(new Error('busy'))
    const a = renderHook(() => useScanStatus())
    const b = renderHook(() => useScanStatus())

    await act(() => a.result.current.startRescan().catch(() => {}))

    expect(a.result.current.status.running).toBe(false)
    expect(b.result.current.status.running).toBe(false)
  })

  it('records the last result once a scan that found something finishes', async () => {
    mockApi.get.mockResolvedValue({
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

  // A scan whose process died is cleared rather than asked to stop (issue #524),
  // so the controls unblock immediately instead of waiting on the next poll.
  it.each(['cleared_stale', 'not_running'])(
    'returns to idle at once when the backend reports %s',
    async (outcome) => {
      mockApi.get.mockResolvedValue({ running: true, phase: 'scanning' })
      const { result } = renderHook(() => useScanStatus())
      await waitFor(() => expect(result.current.status.running).toBe(true))
      // The backend reports idle from here on, but the hook would not poll it
      // again for another second without the immediate reset.
      mockApi.post.mockImplementation(async () => {
        mockApi.get.mockResolvedValue({ running: false, phase: null })
        return { status: outcome }
      })

      await act(() => result.current.stopScan())

      expect(result.current.stopping).toBe(false)
      expect(result.current.status.running).toBe(false)
      expect(result.current.status.phase).toBe(null)
    }
  )

  it('keeps showing the scan while a live one winds down', async () => {
    mockApi.get.mockResolvedValue({ running: true, phase: 'scanning' })
    const { result } = renderHook(() => useScanStatus())
    await waitFor(() => expect(result.current.status.running).toBe(true))
    mockApi.post.mockResolvedValue({ status: 'stop_requested' })

    await act(() => result.current.stopScan())

    expect(result.current.stopping).toBe(true)
    expect(result.current.status.running).toBe(true)
  })

  describe('one poll for the whole page', () => {
    function setHidden(hidden: boolean) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      setHidden(false)
      vi.useRealTimers()
    })

    it('however many controls are on screen, polls once per interval', async () => {
      const hooks = [1, 2, 3, 4, 5, 6].map(() => renderHook(() => useScanStatus()))
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(api.get).toHaveBeenCalledTimes(1)

      await act(() => vi.advanceTimersByTimeAsync(30000))
      expect(api.get).toHaveBeenCalledTimes(2)

      // Still one poller after some of them leave, none after all of them do.
      hooks.slice(0, 5).forEach((h) => h.unmount())
      await act(() => vi.advanceTimersByTimeAsync(30000))
      expect(api.get).toHaveBeenCalledTimes(3)
      hooks[5].unmount()
      await vi.advanceTimersByTimeAsync(120000)
      expect(api.get).toHaveBeenCalledTimes(3)
    })

    it('polls every second while a scan runs, and drops back when it ends', async () => {
      mockApi.get.mockResolvedValue({ running: true, phase: 'scanning' })
      const { result } = renderHook(() => useScanStatus())
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(result.current.status.running).toBe(true)
      const before = mockApi.get.mock.calls.length

      await act(() => vi.advanceTimersByTimeAsync(3000))
      expect(mockApi.get.mock.calls.length - before).toBe(3)

      mockApi.get.mockResolvedValue({ running: false, phase: null })
      await act(() => vi.advanceTimersByTimeAsync(1000))
      expect(result.current.status.running).toBe(false)
      const idle = mockApi.get.mock.calls.length
      await act(() => vi.advanceTimersByTimeAsync(29000))
      expect(mockApi.get.mock.calls.length).toBe(idle)
    })

    it('stops asking while the tab is hidden and asks at once when it is shown', async () => {
      renderHook(() => useScanStatus())
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(api.get).toHaveBeenCalledTimes(1)

      setHidden(true)
      await act(() => vi.advanceTimersByTimeAsync(300000))
      expect(api.get).toHaveBeenCalledTimes(1)

      setHidden(false)
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(api.get).toHaveBeenCalledTimes(2)
    })

    it('shows a scan something else on the page started', async () => {
      const { result } = renderHook(() => useScanStatus())
      await act(() => vi.advanceTimersByTimeAsync(0))
      mockApi.get.mockResolvedValue({ running: true, phase: 'scanning' })

      act(() => {
        window.dispatchEvent(new Event(SCAN_STARTED))
      })

      expect(result.current.status.running).toBe(true)
      expect(result.current.status.phase).toBe('scanning')
    })

    it('starts from scratch once every control has left the page', async () => {
      mockApi.get.mockResolvedValue({ running: true, phase: 'ocr' })
      const first = renderHook(() => useScanStatus())
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(first.result.current.status.phase).toBe('ocr')
      first.unmount()

      mockApi.get.mockReturnValue(new Promise(() => {}))
      const second = renderHook(() => useScanStatus())
      expect(second.result.current.status.running).toBe(false)
      expect(second.result.current.status.phase).toBe(null)
    })

    it('drops an answer that arrives after everything unmounted', async () => {
      let answer: (value: unknown) => void = () => {}
      mockApi.get.mockReturnValue(new Promise((resolve) => (answer = resolve)))
      const first = renderHook(() => useScanStatus())
      first.unmount()

      mockApi.get.mockReturnValue(new Promise(() => {}))
      const second = renderHook(() => useScanStatus())
      await act(async () => {
        answer({ running: true, phase: 'scanning' })
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(second.result.current.status.running).toBe(false)
    })
  })
})
