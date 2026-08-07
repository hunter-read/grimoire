import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useFillViewport from './useFillViewport'

// jsdom gives every element a zero-sized rect, so tests stub the one value the
// hook reads (the element's distance from the top of the viewport).
function elementAt(top) {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  return el
}

const originalHeight = window.innerHeight
const originalRO = globalThis.ResizeObserver

function setViewportHeight(h) {
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true, writable: true })
}

beforeEach(() => {
  setViewportHeight(900)
})

afterEach(() => {
  setViewportHeight(originalHeight)
  globalThis.ResizeObserver = originalRO
  vi.restoreAllMocks()
})

describe('useFillViewport', () => {
  it('returns the space between the element top and the bottom of the viewport', () => {
    const ref = { current: elementAt(100) }
    const { result } = renderHook(() => useFillViewport(ref))
    // 900 viewport - 100 top - 24 bottom gap
    expect(result.current).toBe(776)
  })

  it('returns null when the leftover space is below the minimum', () => {
    const ref = { current: elementAt(700) }
    // 900 - 700 - 24 = 176, under the 320 default minimum.
    const { result } = renderHook(() => useFillViewport(ref))
    expect(result.current).toBeNull()
  })

  it('honours a custom minimum', () => {
    const ref = { current: elementAt(700) }
    const { result } = renderHook(() => useFillViewport(ref, { min: 100 }))
    expect(result.current).toBe(176)
  })

  it('returns null while disabled', () => {
    const ref = { current: elementAt(100) }
    const { result } = renderHook(() => useFillViewport(ref, { enabled: false }))
    expect(result.current).toBeNull()
  })

  it('recomputes when the window resizes', () => {
    const ref = { current: elementAt(100) }
    const { result } = renderHook(() => useFillViewport(ref))
    expect(result.current).toBe(776)
    act(() => {
      setViewportHeight(600)
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(476)
  })

  it('drops to null when a resize leaves too little room', () => {
    const ref = { current: elementAt(100) }
    const { result } = renderHook(() => useFillViewport(ref))
    expect(result.current).toBe(776)
    act(() => {
      setViewportHeight(300)
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBeNull()
  })

  it('recomputes when an observed element reflows', () => {
    let notify
    globalThis.ResizeObserver = class {
      constructor(cb) {
        notify = cb
      }
      observe() {}
      disconnect() {}
    }
    const el = elementAt(100)
    const ref = { current: el }
    const { result } = renderHook(() => useFillViewport(ref))
    expect(result.current).toBe(776)
    // Content above the editor grew, pushing it down without a window resize.
    el.getBoundingClientRect = () => ({ top: 200 })
    act(() => notify())
    expect(result.current).toBe(676)
  })

  it('works when ResizeObserver is unavailable', () => {
    globalThis.ResizeObserver = undefined
    const ref = { current: elementAt(100) }
    const { result } = renderHook(() => useFillViewport(ref))
    expect(result.current).toBe(776)
  })

  it('leaves the height untouched when the ref is empty', () => {
    const ref = { current: null }
    const { result } = renderHook(() => useFillViewport(ref))
    expect(result.current).toBeNull()
  })

  it('removes its resize listener on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const ref = { current: elementAt(100) }
    const { unmount } = renderHook(() => useFillViewport(ref))
    unmount()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  it('disconnects its observer on unmount', () => {
    const disconnect = vi.fn()
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect = disconnect
    }
    const ref = { current: elementAt(100) }
    const { unmount } = renderHook(() => useFillViewport(ref))
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
