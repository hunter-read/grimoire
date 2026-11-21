import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useRenderBatches from './useRenderBatches'

describe('useRenderBatches', () => {
  it('starts with the first batch and grows a step at a time until all are in', async () => {
    const { result } = renderHook(() => useRenderBatches(25, 10, 5))
    expect(result.current).toBe(10)
    const seen = [result.current]
    await waitFor(() => {
      if (seen[seen.length - 1] !== result.current) seen.push(result.current)
      expect(result.current).toBeGreaterThanOrEqual(25)
    })
    // Every batch shows: it never jumps straight to the whole list.
    expect(seen.length).toBeGreaterThan(1)
    expect(result.current).toBe(25)
  })

  it('schedules nothing for a list that fits in the first batch', () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame')
    const { result } = renderHook(() => useRenderBatches(3, 10, 5))
    expect(result.current).toBe(10)
    expect(frame).not.toHaveBeenCalled()
    frame.mockRestore()
  })

  it('picks up when the list arrives after mount', async () => {
    const { result, rerender } = renderHook(({ total }) => useRenderBatches(total, 2, 2), {
      initialProps: { total: 0 },
    })
    expect(result.current).toBe(2)
    rerender({ total: 7 })
    await waitFor(() => expect(result.current).toBe(8))
  })

  it('cancels a pending batch when unmounted', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const { unmount } = renderHook(() => useRenderBatches(100, 10, 10))
    unmount()
    expect(cancel).toHaveBeenCalled()
    cancel.mockRestore()
  })
})
