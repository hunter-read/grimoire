import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useCoarsePointer from './useCoarsePointer'

const realMatchMedia = globalThis.matchMedia

/** Stub matchMedia, capturing the listener so a change can be simulated. */
function stubPointer(matches) {
  const listeners = new Set()
  globalThis.matchMedia = vi.fn((media) => ({
    matches,
    media,
    addEventListener: (_, cb) => listeners.add(cb),
    removeEventListener: (_, cb) => listeners.delete(cb),
  }))
  return {
    change: (next) =>
      act(() => {
        listeners.forEach((cb) => cb({ matches: next }))
      }),
  }
}

afterEach(() => {
  globalThis.matchMedia = realMatchMedia
})

describe('useCoarsePointer', () => {
  it('is true on a touch screen', () => {
    stubPointer(true)
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(true)
    expect(globalThis.matchMedia).toHaveBeenCalledWith('(pointer: coarse)')
  })

  it('is false with a mouse', () => {
    stubPointer(false)
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
  })

  it('follows a change, so a 2-in-1 folded to tablet updates', () => {
    const { change } = stubPointer(false)
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
    change(true)
    expect(result.current).toBe(true)
  })

  it('falls back to false where matchMedia is missing', () => {
    globalThis.matchMedia = undefined
    // Server-rendered or an old browser: assume a mouse rather than throwing,
    // which keeps drag-and-drop rather than silently disabling it.
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
  })
})
