import { describe, it, expect } from 'vitest'
import {
  ICON_COLOR_NAMES,
  ICON_COLOR_PRESETS,
  isValidIconColor,
  resolveIconColor,
} from './iconColors'

describe('icon colour presets', () => {
  it('exposes every preset as a six-digit hex', () => {
    expect(ICON_COLOR_NAMES.length).toBeGreaterThan(0)
    for (const name of ICON_COLOR_NAMES) {
      expect(ICON_COLOR_PRESETS[name]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('isValidIconColor', () => {
  it('accepts preset tokens and #rrggbb literals', () => {
    expect(isValidIconColor('gold')).toBe(true)
    expect(isValidIconColor('  RED ')).toBe(true)
    expect(isValidIconColor('#a1b2c3')).toBe(true)
    expect(isValidIconColor('#A1B2C3')).toBe(true)
  })

  it('rejects anything else, including CSS that could escape a style attribute', () => {
    for (const bad of [
      '',
      'nosuchcolor',
      '#abc',
      '#12345g',
      'red; background: url(x)',
      'url(javascript:alert(1))',
      'var(--red)',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isValidIconColor(bad)).toBe(false)
    }
  })
})

describe('resolveIconColor', () => {
  it('maps a preset token to its hex', () => {
    expect(resolveIconColor('blue')).toBe(ICON_COLOR_PRESETS.blue)
    expect(resolveIconColor(' Gold ')).toBe(ICON_COLOR_PRESETS.gold)
  })

  it('passes a hex literal through, normalized to lowercase', () => {
    expect(resolveIconColor('#AABBCC')).toBe('#aabbcc')
  })

  it('returns the fallback for unset or invalid values', () => {
    expect(resolveIconColor(null)).toBeUndefined()
    expect(resolveIconColor('')).toBeUndefined()
    expect(resolveIconColor('bogus')).toBeUndefined()
    expect(resolveIconColor('bogus', 'var(--text)')).toBe('var(--text)')
    expect(resolveIconColor(undefined, '#000000')).toBe('#000000')
  })
})
