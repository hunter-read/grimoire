import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  THEME_MODES,
  DEFAULT_MODE,
  isSafeColor,
  sanitizeTokens,
  getThemeMode,
  setThemeMode,
  resolveMode,
  applyTokens,
  setThemeTokens,
  getStoredTokens,
  initTheme,
  sanitizeVariants,
  variantFor,
  getStoredVariants,
  setThemeVariants,
} from './theme'

/** Stub matchMedia so `system` mode is deterministic. */
function stubMatchMedia(matches) {
  const listeners = new Set()
  const mql = {
    matches,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    fire: () => listeners.forEach((fn) => fn()),
    listenerCount: () => listeners.size,
  }
  vi.stubGlobal('matchMedia', () => mql)
  return mql
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.cssText = ''
  stubMatchMedia(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mode selection', () => {
  it('defaults to dark when nothing is stored', () => {
    expect(getThemeMode()).toBe(DEFAULT_MODE)
  })

  it('ignores an unrecognised stored mode', () => {
    localStorage.setItem('grimoire:theme-mode', 'chartreuse')
    expect(getThemeMode()).toBe(DEFAULT_MODE)
  })

  it('persists and stamps the chosen mode onto <html>', () => {
    setThemeMode('light')
    expect(getThemeMode()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('resolves system mode from the OS preference', () => {
    stubMatchMedia(true)
    expect(resolveMode('system')).toBe('dark')
    stubMatchMedia(false)
    expect(resolveMode('system')).toBe('light')
  })

  it('exposes exactly the three supported modes', () => {
    expect(THEME_MODES).toEqual(['light', 'dark', 'system'])
  })

  it('follows the OS when the preference changes in system mode', () => {
    const mql = stubMatchMedia(false)
    setThemeMode('system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    const stop = initTheme()
    mql.matches = true
    mql.fire()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    stop()
    expect(mql.listenerCount()).toBe(0)
  })

  it('ignores OS changes when a fixed mode is chosen', () => {
    const mql = stubMatchMedia(false)
    setThemeMode('dark')
    initTheme()

    mql.matches = false
    mql.fire()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('colour validation', () => {
  it.each(['#fff', '#c9a84c', '#c9a84cff', 'rgb(1,2,3)', 'rgba(1,2,3,0.5)', 'hsl(30 40% 50%)'])(
    'accepts %s',
    (value) => {
      expect(isSafeColor(value)).toBe(true)
    }
  )

  // The point of the allowlist: a value that tries to close the declaration and
  // start another one must not survive.
  it.each([
    'red; background: url(https://evil.example/pixel.png)',
    'url(https://evil.example/x.png)',
    'expression(alert(1))',
    '#fff /* } body { display:none */',
    'var(--something-else)',
    '',
    null,
    42,
  ])('rejects %s', (value) => {
    expect(isSafeColor(value)).toBe(false)
  })

  it('rejects an absurdly long value', () => {
    expect(isSafeColor(`#${'a'.repeat(200)}`)).toBe(false)
  })
})

describe('sanitizeTokens', () => {
  it('keeps allowlisted tokens with valid colours', () => {
    expect(sanitizeTokens({ text: '#fff', 'bg-card': 'rgb(0,0,0)' })).toEqual({
      text: '#fff',
      'bg-card': 'rgb(0,0,0)',
    })
  })

  it('allows a theme to restyle the variant accent', () => {
    // `--variant` is wired through --p-variant like every other token, but was
    // missing from the allowlist — leaving it the one accent a custom palette
    // could not override, so a high-contrast theme inherited the built-in teal.
    expect(sanitizeTokens({ variant: '#00504a' })).toEqual({ variant: '#00504a' })
  })

  it('drops tokens that are not on the allowlist', () => {
    expect(sanitizeTokens({ 'background-image': 'url(x)', 'font-family': 'evil' })).toEqual({})
  })

  it('drops allowlisted tokens carrying an unsafe value', () => {
    expect(sanitizeTokens({ text: 'red; background: url(https://evil.example/)' })).toEqual({})
  })

  it('tolerates junk input', () => {
    expect(sanitizeTokens(null)).toEqual({})
    expect(sanitizeTokens('nope')).toEqual({})
  })
})

describe('token application', () => {
  it('writes sanitized tokens onto the palette layer', () => {
    applyTokens({ text: '#123456' })
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('#123456')
  })

  it('never writes a rejected token', () => {
    applyTokens({ text: 'red; background: url(https://evil.example/)' })
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('')
  })

  it('clears tokens the new theme does not set', () => {
    applyTokens({ text: '#123456' })
    applyTokens({ 'bg-card': '#654321' })
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--p-bg-card')).toBe('#654321')
  })

  it('round-trips tokens through storage', () => {
    setThemeTokens({ text: '#abcdef' })
    expect(getStoredTokens()).toEqual({ text: '#abcdef' })
  })

  it('reverts to the built-in palette when cleared', () => {
    setThemeTokens({ text: '#abcdef' })
    setThemeTokens({})
    expect(getStoredTokens()).toEqual({})
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('')
  })

  it('recovers from corrupt stored tokens', () => {
    localStorage.setItem('grimoire:theme-tokens', '{not json')
    expect(getStoredTokens()).toEqual({})
  })
})

/**
 * A theme may pair a light and a dark palette so one entry covers System mode.
 */
describe('paired light/dark variants', () => {
  const PAIRED = { light: { text: '#000000' }, dark: { text: '#ffffff' } }

  it('keeps both palettes', () => {
    expect(sanitizeVariants(PAIRED)).toEqual(PAIRED)
  })

  it('drops a variant that sets nothing usable', () => {
    expect(sanitizeVariants({ light: { text: '#000' }, dark: { nope: 'x' } })).toEqual({
      light: { text: '#000' },
    })
  })

  it('applies the allowlist inside each variant', () => {
    expect(
      sanitizeVariants({ dark: { text: 'red; background: url(https://evil/)', accent: '#fff' } })
    ).toEqual({ dark: { accent: '#fff' } })
  })

  it('tolerates junk', () => {
    expect(sanitizeVariants(null)).toEqual({})
    expect(sanitizeVariants('nope')).toEqual({})
  })

  it('picks the variant matching the resolved mode', () => {
    expect(variantFor(PAIRED, 'light')).toEqual({ text: '#000000' })
    expect(variantFor(PAIRED, 'dark')).toEqual({ text: '#ffffff' })
  })

  // A one-mode theme stays visible rather than switching itself off half the
  // time — the user picked it, so it should keep applying.
  it('falls back to the only variant a single-mode theme ships', () => {
    expect(variantFor({ dark: { text: '#fff' } }, 'light')).toEqual({ text: '#fff' })
  })

  it('returns nothing when there are no variants at all', () => {
    expect(variantFor({}, 'dark')).toEqual({})
  })

  it('round-trips variants through storage', () => {
    setThemeVariants(PAIRED)
    expect(getStoredVariants()).toEqual(PAIRED)
  })

  it('applies the current mode’s variant when stored', () => {
    setThemeMode('light')
    setThemeVariants(PAIRED)
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('#000000')
  })

  it('switches variant when the colour mode changes', () => {
    setThemeVariants(PAIRED)
    setThemeMode('dark')
    applyTokens(variantFor(getStoredVariants(), resolveMode('dark')))
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('#ffffff')

    setThemeMode('light')
    applyTokens(variantFor(getStoredVariants(), resolveMode('light')))
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('#000000')
  })

  // The point of pairing: System mode has to swap the theme's own palette too,
  // not just the built-in one.
  it('follows the OS in system mode, within one theme', () => {
    const mql = stubMatchMedia(true)
    setThemeMode('system')
    setThemeVariants(PAIRED)
    const stop = initTheme()
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('#ffffff')

    mql.matches = false
    mql.fire()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('#000000')
    stop()
  })

  it('clears the variants when reverting to the built-in theme', () => {
    setThemeVariants(PAIRED)
    setThemeVariants({})
    expect(getStoredVariants()).toEqual({})
    expect(document.documentElement.style.getPropertyValue('--p-text')).toBe('')
  })

  it('recovers from corrupt stored variants', () => {
    localStorage.setItem('grimoire:theme-variants', '{not json')
    expect(getStoredVariants()).toEqual({})
  })
})
