import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useCoarsePointer from './useCoarsePointer'

const realMatchMedia = globalThis.matchMedia

/** Stub matchMedia, capturing the listener so a change can be simulated. */
type Listener = (e: { matches: boolean }) => void

function stubPointer(matches: boolean) {
  const listeners = new Set<Listener>()
  globalThis.matchMedia = vi.fn((media: string) => ({
    matches,
    media,
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
  })) as unknown as typeof globalThis.matchMedia
  return {
    change: (next: boolean) =>
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
    globalThis.matchMedia = undefined as unknown as typeof globalThis.matchMedia
    // Server-rendered or an old browser: assume a mouse rather than throwing,
    // which keeps drag-and-drop rather than silently disabling it.
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
  })
})
