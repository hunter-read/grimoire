import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import useInViewOnce from './useInViewOnce'

const realObserver = globalThis.IntersectionObserver
afterEach(() => {
  globalThis.IntersectionObserver = realObserver
})

const refTo = (el: Element | null) => ({ current: el })

describe('useInViewOnce', () => {
  it('turns true once the element nears the viewport, and stays true', () => {
    let fire: (visible: boolean) => void = () => {}
    const disconnect = vi.fn()
    globalThis.IntersectionObserver = class {
      constructor(cb: IntersectionObserverCallback) {
        fire = (visible) =>
          cb(
            [{ isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          )
      }
      observe() {}
      disconnect = disconnect
    } as unknown as typeof IntersectionObserver

    const { result } = renderHook(() => useInViewOnce(refTo(document.createElement('div'))))
    expect(result.current).toBe(false)
    act(() => fire(false))
    expect(result.current).toBe(false)
    act(() => fire(true))
    expect(result.current).toBe(true)
    expect(disconnect).toHaveBeenCalled()
  })

  it('is true straight away without IntersectionObserver', () => {
    // @ts-expect-error - simulating a browser without it
    delete globalThis.IntersectionObserver
    const { result } = renderHook(() => useInViewOnce(refTo(document.createElement('div'))))
    expect(result.current).toBe(true)
  })

  it('waits while there is no element', () => {
    const { result } = renderHook(() => useInViewOnce(refTo(null)))
    expect(result.current).toBe(false)
  })
})
