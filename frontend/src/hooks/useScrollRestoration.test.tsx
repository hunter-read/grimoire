import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import useScrollRestoration from './useScrollRestoration'

// Wrap the hook in a MemoryRouter so useLocation works.
function makeWrapper(initialPath = '/') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  }
}

// A component that attaches the hook's ref to a real div so we can test
// DOM-dependent behaviour (save on unmount, restore on mount).
function ScrollComponent({ onRef }: { onRef?: (el: HTMLDivElement | null) => void } = {}) {
  const ref = useScrollRestoration<HTMLDivElement>()
  return (
    <div
      ref={(el) => {
        ref.current = el
        onRef?.(el)
      }}
      style={{ height: '200px', overflow: 'auto' }}
    />
  )
}

describe('useScrollRestoration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
    // requestAnimationFrame is not available in jsdom — stub it to run synchronously.
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      cb()
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  it('returns a ref object', () => {
    const { result } = renderHook(() => useScrollRestoration(), {
      wrapper: makeWrapper('/library'),
    })
    expect(result.current).toHaveProperty('current')
  })

  it('does not throw when the ref is not attached to a DOM element', () => {
    expect(() => {
      renderHook(() => useScrollRestoration(), {
        wrapper: makeWrapper('/library'),
      })
    }).not.toThrow()
  })

  it('does not write to sessionStorage on mount when no prior state exists', () => {
    renderHook(() => useScrollRestoration(), {
      wrapper: makeWrapper('/library'),
    })
    expect(sessionStorage.getItem('grimoire:scroll:/library')).toBeNull()
  })

  it('saves scrollTop as the user scrolls', () => {
    let divEl = null as HTMLDivElement | null
    render(
      <MemoryRouter initialEntries={['/library']}>
        <ScrollComponent
          onRef={(el) => {
            divEl = el
          }}
        />
      </MemoryRouter>
    )

    // jsdom div doesn't have real scrollTop, so set it manually.
    Object.defineProperty(divEl!, 'scrollTop', { value: 250, writable: true, configurable: true })
    act(() => {
      divEl!.dispatchEvent(new Event('scroll'))
    })

    expect(sessionStorage.getItem('grimoire:scroll:/library')).toBe('250')
  })

  it('keeps an offset read before unmount whose write was still pending', () => {
    // The write waits a frame; leaving before it lands must not lose it.
    vi.stubGlobal('requestAnimationFrame', () => 1)
    let divEl = null as HTMLDivElement | null
    const { unmount } = render(
      <MemoryRouter initialEntries={['/library']}>
        <ScrollComponent
          onRef={(el) => {
            divEl = el
          }}
        />
      </MemoryRouter>
    )
    Object.defineProperty(divEl!, 'scrollTop', { value: 320, writable: true, configurable: true })
    divEl!.dispatchEvent(new Event('scroll'))
    expect(sessionStorage.getItem('grimoire:scroll:/library')).toBeNull()

    unmount()

    expect(sessionStorage.getItem('grimoire:scroll:/library')).toBe('320')
  })

  it('restores scrollTop from sessionStorage after mounting with a saved position', () => {
    sessionStorage.setItem('grimoire:scroll:/library', '400')

    let divEl = null as HTMLDivElement | null
    render(
      <MemoryRouter initialEntries={['/library']}>
        <ScrollComponent
          onRef={(el) => {
            divEl = el
          }}
        />
      </MemoryRouter>
    )

    // The rAF stub fires synchronously, so scrollTop should already be set.
    expect(divEl?.scrollTop).toBe(400)
  })

  it('leaves scrollTop unchanged when no saved position exists', () => {
    let divEl = null as HTMLDivElement | null
    render(
      <MemoryRouter initialEntries={['/library']}>
        <ScrollComponent
          onRef={(el) => {
            divEl = el
          }}
        />
      </MemoryRouter>
    )

    // No saved state — scrollTop stays at its default (0 in jsdom).
    expect(divEl?.scrollTop ?? 0).toBe(0)
  })

  // jsdom has no layout, so scrollTop accepts any value. These tests install a
  // clamping accessor that mimics a real element: writes above the current
  // content height are pinned, exactly the situation that made restoration fail
  // while a view was still loading its data (issue #257).
  function makeClamped(el: HTMLElement, initialMaxScroll: number) {
    let value = 0
    let maxScroll = initialMaxScroll
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => value,
      set: (v: number) => {
        value = Math.min(v, maxScroll)
      },
    })
    return {
      // Simulates the view's data arriving and the content growing taller.
      grow: (next: number) => {
        maxScroll = next
      },
    }
  }

  it('retries across frames until the content is tall enough to reach the saved offset', () => {
    sessionStorage.setItem('grimoire:scroll:/library', '400')

    // Drive rAF manually so we control when each restore attempt runs.
    const callbacks: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => callbacks.push(cb))

    let divEl = null as HTMLDivElement | null
    let content = null as ReturnType<typeof makeClamped> | null
    render(
      <MemoryRouter initialEntries={['/library']}>
        <ScrollComponent
          onRef={(el) => {
            if (el && !content) content = makeClamped(el, 0)
            divEl = el
          }}
        />
      </MemoryRouter>
    )

    const flush = () => {
      const pending = callbacks.splice(0, callbacks.length)
      act(() => pending.forEach((cb) => cb()))
    }

    // First frame: the view is still empty, so the write clamps to 0.
    flush()
    expect(divEl!.scrollTop).toBe(0)

    // Still loading — the hook keeps a retry queued rather than giving up.
    flush()
    expect(divEl!.scrollTop).toBe(0)
    expect(callbacks.length).toBeGreaterThan(0)

    // Data arrives and the grid renders: the next retry lands the position.
    content!.grow(1000)
    flush()
    expect(divEl!.scrollTop).toBe(400)

    // Target reached, so the loop stops queueing further frames.
    expect(callbacks).toHaveLength(0)
  })

  it('stops retrying once the user scrolls the container themselves', () => {
    sessionStorage.setItem('grimoire:scroll:/library', '400')

    const callbacks: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => callbacks.push(cb))

    let divEl = null as HTMLDivElement | null
    let content = null as ReturnType<typeof makeClamped> | null
    render(
      <MemoryRouter initialEntries={['/library']}>
        <ScrollComponent
          onRef={(el) => {
            if (el && !content) content = makeClamped(el, 0)
            divEl = el
          }}
        />
      </MemoryRouter>
    )

    const flush = () => {
      const pending = callbacks.splice(0, callbacks.length)
      act(() => pending.forEach((cb) => cb()))
    }

    flush()
    expect(divEl!.scrollTop).toBe(0)

    // The user scrolls while the view is still loading — they've taken over.
    act(() => {
      divEl!.dispatchEvent(new Event('wheel'))
    })

    // Even once the content grows, the saved offset is no longer forced on them.
    content!.grow(1000)
    flush()
    expect(divEl!.scrollTop).toBe(0)
    expect(callbacks).toHaveLength(0)
  })

  it('gives up after the timeout when the view never grows tall enough', () => {
    sessionStorage.setItem('grimoire:scroll:/library', '400')

    const callbacks: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => callbacks.push(cb))
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(0)

    let content = null as ReturnType<typeof makeClamped> | null
    render(
      <MemoryRouter initialEntries={['/library']}>
        <ScrollComponent
          onRef={(el) => {
            if (el && !content) content = makeClamped(el, 0)
          }}
        />
      </MemoryRouter>
    )

    const flush = () => {
      const pending = callbacks.splice(0, callbacks.length)
      act(() => pending.forEach((cb) => cb()))
    }

    flush()
    expect(callbacks.length).toBeGreaterThan(0)

    // Past the retry window with the content still short: the loop ends instead
    // of spinning forever on a view that simply got shorter.
    nowSpy.mockReturnValue(10_000)
    flush()
    expect(callbacks).toHaveLength(0)

    nowSpy.mockRestore()
  })

  it('does not attempt restoration for a saved position of zero', () => {
    sessionStorage.setItem('grimoire:scroll:/library', '0')

    const callbacks: (() => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => callbacks.push(cb))

    render(
      <MemoryRouter initialEntries={['/library']}>
        <ScrollComponent />
      </MemoryRouter>
    )

    // Nothing to restore — no retry loop is started at all.
    expect(callbacks).toHaveLength(0)
  })

  describe('across a navigation (issue #947)', () => {
    let go: (path: string) => void = () => {}
    function Nav() {
      const navigate = useNavigate()
      go = (path) => navigate(path)
      return null
    }

    function renderAt(path: string) {
      let divEl = null as HTMLDivElement | null
      render(
        <MemoryRouter initialEntries={[path]}>
          <Nav />
          <ScrollComponent
            onRef={(el) => {
              divEl = el
            }}
          />
        </MemoryRouter>
      )
      let value = 0
      Object.defineProperty(divEl!, 'scrollTop', {
        configurable: true,
        get: () => value,
        set: (v: number) => {
          value = v
        },
      })
      const scrollTo = (top: number) => {
        value = top
        act(() => {
          divEl!.dispatchEvent(new Event('scroll'))
        })
      }
      return { el: () => divEl!, scrollTo }
    }

    it('never records the next view’s clamp under the page that was left', () => {
      const view = renderAt('/library')
      view.scrollTo(1800)

      // Opening a book swaps in the full-height reader: the browser clamps the
      // container to 0 and fires a scroll event for it, after the navigation.
      act(() => go('/library/book/b1'))
      view.scrollTo(0)

      expect(sessionStorage.getItem('grimoire:scroll:/library')).toBe('1800')
      expect(sessionStorage.getItem('grimoire:scroll:/library/book/b1')).toBe('0')
    })

    it('returns to the same place on coming back', () => {
      const view = renderAt('/library')
      view.scrollTo(1800)
      act(() => go('/library/book/b1'))
      view.scrollTo(0)

      act(() => go('/library'))

      expect(view.el().scrollTop).toBe(1800)
    })

    it('does not let the restore’s own scrolling replace the saved offset', () => {
      sessionStorage.setItem('grimoire:scroll:/library', '900')
      // Hold the restore mid-flight: its first frame never runs.
      vi.stubGlobal('requestAnimationFrame', () => 1)
      const view = renderAt('/library')

      // A clamp while the list is still loading.
      view.scrollTo(40)

      expect(sessionStorage.getItem('grimoire:scroll:/library')).toBe('900')
    })
  })
})
