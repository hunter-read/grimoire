import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import useIdleAwareInterval from './useIdleAwareInterval'
import { IDLE_AFTER_MS } from '../lib/userActivity'

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useIdleAwareInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    setHidden(false)
    vi.useRealTimers()
  })

  it('runs the callback every interval while the tab is in use', () => {
    const callback = vi.fn()
    renderHook(() => useIdleAwareInterval(callback, 1000))
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('does nothing when the interval is null', () => {
    const callback = vi.fn()
    renderHook(() => useIdleAwareInterval(callback, null))
    vi.advanceTimersByTime(60000)
    expect(callback).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timer once the tab is hidden, and resumes at once when shown', () => {
    const callback = vi.fn()
    renderHook(() => useIdleAwareInterval(callback, 1000))
    setHidden(true)
    vi.advanceTimersByTime(1000)
    expect(callback).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    setHidden(false)
    expect(callback).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('stops after the idle window without input, and resumes on input', () => {
    const callback = vi.fn()
    renderHook(() => useIdleAwareInterval(callback, 30000))
    vi.advanceTimersByTime(IDLE_AFTER_MS + 30000)
    const whileActive = callback.mock.calls.length
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(IDLE_AFTER_MS)
    expect(callback).toHaveBeenCalledTimes(whileActive)

    window.dispatchEvent(new Event('pointerdown'))
    expect(callback).toHaveBeenCalledTimes(whileActive + 1)
    vi.advanceTimersByTime(30000)
    expect(callback).toHaveBeenCalledTimes(whileActive + 2)
  })

  it('uses the latest callback without restarting, and a new interval when it changes', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ cb, ms }: { cb: () => void; ms: number }) => useIdleAwareInterval(cb, ms),
      { initialProps: { cb: first, ms: 1000 } }
    )
    vi.advanceTimersByTime(500)
    rerender({ cb: second, ms: 1000 })
    vi.advanceTimersByTime(500)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    rerender({ cb: second, ms: 5000 })
    vi.advanceTimersByTime(4999)
    expect(second).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('stops for good on unmount', () => {
    const callback = vi.fn()
    const { unmount } = renderHook(() => useIdleAwareInterval(callback, 1000))
    unmount()
    vi.advanceTimersByTime(5000)
    window.dispatchEvent(new Event('keydown'))
    expect(callback).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
