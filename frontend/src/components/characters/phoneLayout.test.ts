import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { PHONE_SHEET_QUERY, forViewport, hasPhoneLayout, usePhoneViewport } from './phoneLayout'

type Listener = (event: { matches: boolean }) => void

function installMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<Listener>()
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    addEventListener: (_type: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_type: string, cb: Listener) => listeners.delete(cb),
  }))
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia
  return {
    matchMedia,
    listeners,
    set(next: boolean) {
      matches = next
      listeners.forEach((cb) => cb({ matches }))
    },
  }
}

const originalMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

describe('usePhoneViewport', () => {
  it('asks the phone-sized query', () => {
    const media = installMatchMedia(false)
    renderHook(() => usePhoneViewport())
    expect(media.matchMedia).toHaveBeenCalledWith(PHONE_SHEET_QUERY)
    expect(PHONE_SHEET_QUERY).toBe('(max-width: 640px)')
  })

  it('follows the viewport across the breakpoint and stops listening on unmount', () => {
    const media = installMatchMedia(true)
    const { result, unmount } = renderHook(() => usePhoneViewport())
    expect(result.current).toBe(true)
    act(() => media.set(false))
    expect(result.current).toBe(false)
    act(() => media.set(true))
    expect(result.current).toBe(true)
    unmount()
    expect(media.listeners.size).toBe(0)
  })

  it('reads as not a phone where matchMedia is unavailable', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia
    const { result } = renderHook(() => usePhoneViewport())
    expect(result.current).toBe(false)
  })
})

describe('forViewport', () => {
  const sheet = {
    layout_ast: [{ tag: 'div' }],
    styles_css: '.gc-sheet .d { color: red }',
    mobile_layout_ast: [{ tag: 'section' }],
    mobile_styles_css: '.gc-sheet .m { color: blue }',
  }

  it('swaps in the phone pair on a phone', () => {
    const drawn = forViewport(sheet, true)
    expect(drawn.layout_ast).toEqual([{ tag: 'section' }])
    expect(drawn.styles_css).toBe('.gc-sheet .m { color: blue }')
  })

  it('leaves the document alone off a phone', () => {
    expect(forViewport(sheet, false)).toBe(sheet)
  })

  it('hands on no stylesheet for a phone layout without one', () => {
    const bare = { ...sheet, mobile_styles_css: undefined }
    expect(forViewport(bare, true).styles_css).toBe('')
  })

  it('passes a missing document through', () => {
    expect(forViewport(null, true)).toBeNull()
    expect(forViewport(undefined, true)).toBeUndefined()
  })

  it('needs a non-empty phone layout', () => {
    expect(hasPhoneLayout(sheet)).toBe(true)
    expect(hasPhoneLayout({ mobile_layout_ast: [] })).toBe(false)
    expect(hasPhoneLayout({ mobile_layout_ast: 'nope' })).toBe(false)
    expect(hasPhoneLayout(null)).toBe(false)
    const plain = { layout_ast: [{ tag: 'div' }] }
    expect(forViewport(plain, true)).toBe(plain)
  })
})
