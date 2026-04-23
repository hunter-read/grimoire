import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import useScrollRestoration from './useScrollRestoration'

// Wrap the hook in a MemoryRouter so useLocation works.
function makeWrapper(initialPath = '/') {
  return function Wrapper({ children }) {
    return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  }
}

// A component that attaches the hook's ref to a real div so we can test
// DOM-dependent behaviour (save on unmount, restore on mount).
function ScrollComponent({ onRef } = {}) {
  const ref = useScrollRestoration()
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
    vi.stubGlobal('requestAnimationFrame', (cb) => {
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

  it('saves scrollTop to sessionStorage on unmount', () => {
    let divEl = null
    const { unmount } = render(
      <MemoryRouter initialEntries={['/library']}>
        <ScrollComponent
          onRef={(el) => {
            divEl = el
          }}
        />
      </MemoryRouter>
    )

    // jsdom div doesn't have real scrollTop, so set it manually.
    if (divEl)
      Object.defineProperty(divEl, 'scrollTop', { value: 250, writable: true, configurable: true })

    unmount()

    expect(sessionStorage.getItem('grimoire:scroll:/library')).toBe('250')
  })

  it('restores scrollTop from sessionStorage after mounting with a saved position', () => {
    sessionStorage.setItem('grimoire:scroll:/library', '400')

    let divEl = null
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
    let divEl = null
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
})
