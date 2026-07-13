import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useIsMobile from './useIsMobile'

// Build a controllable matchMedia mock that lets tests flip `matches` and fire
// the registered 'change' listener.
function installMatchMedia(initialMatches) {
  let matches = initialMatches
  const listeners = new Set()
  const mql = {
    get matches() {
      return matches
    },
    media: '',
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
  }
  window.matchMedia = vi.fn(() => mql)
  return {
    set: (next) => {
      matches = next
      listeners.forEach((cb) => cb({ matches }))
    },
    listenerCount: () => listeners.size,
  }
}

const originalMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = originalMatchMedia
  vi.restoreAllMocks()
})

describe('useIsMobile', () => {
  it('returns true when the media query matches on mount', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('returns false when the media query does not match', () => {
    installMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('updates reactively when the viewport crosses the breakpoint', () => {
    const mm = installMatchMedia(false)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
    act(() => mm.set(true))
    expect(result.current).toBe(true)
    act(() => mm.set(false))
    expect(result.current).toBe(false)
  })

  it('builds a max-width query from the given breakpoint', () => {
    installMatchMedia(false)
    renderHook(() => useIsMobile(640))
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 639px)')
  })

  it('removes its listener on unmount', () => {
    const mm = installMatchMedia(false)
    const { unmount } = renderHook(() => useIsMobile())
    expect(mm.listenerCount()).toBe(1)
    unmount()
    expect(mm.listenerCount()).toBe(0)
  })

  it('falls back to addListener when addEventListener is unavailable', () => {
    let matches = false
    const listeners = new Set()
    const mql = {
      get matches() {
        return matches
      },
      addListener: (cb) => listeners.add(cb),
      removeListener: (cb) => listeners.delete(cb),
    }
    window.matchMedia = vi.fn(() => mql)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
    act(() => {
      matches = true
      listeners.forEach((cb) => cb({ matches }))
    })
    expect(result.current).toBe(true)
  })
})
