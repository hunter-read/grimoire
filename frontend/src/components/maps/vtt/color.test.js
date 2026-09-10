import { describe, it, expect } from 'vitest'
import { argbToAlpha, argbToCss, argbToRgbHex, normalizeArgb, rgbHexToArgb } from './color'

describe('normalizeArgb', () => {
  it('accepts bare 8-digit ARGB', () => {
    expect(normalizeArgb('ffeccd8b')).toBe('ffeccd8b')
  })

  it('strips a leading hash and lowercases', () => {
    expect(normalizeArgb('#FFECCD8B')).toBe('ffeccd8b')
  })

  it('treats 6-digit input as fully opaque', () => {
    expect(normalizeArgb('eccd8b')).toBe('ffeccd8b')
  })

  it('rejects anything else rather than guessing', () => {
    expect(normalizeArgb('red')).toBeNull()
    expect(normalizeArgb(null)).toBeNull()
  })
})

describe('argbToRgbHex', () => {
  it('drops the alpha pair, which leads in this format', () => {
    // Alpha first is the whole trap: reading ffeccd8b as #ffeccd would be the
    // classic UVTT colour bug.
    expect(argbToRgbHex('ffeccd8b')).toBe('#eccd8b')
  })

  it('falls back to white on unparseable input', () => {
    expect(argbToRgbHex('nope')).toBe('#ffffff')
  })
})

describe('argbToAlpha', () => {
  it('reads the leading pair as alpha', () => {
    expect(argbToAlpha('00ffffff')).toBe(0)
    expect(argbToAlpha('ffffffff')).toBe(1)
  })

  it('defaults to opaque when unreadable', () => {
    expect(argbToAlpha('zz')).toBe(1)
  })
})

describe('rgbHexToArgb', () => {
  it('puts alpha first', () => {
    expect(rgbHexToArgb('#eccd8b', 1)).toBe('ffeccd8b')
  })

  it('encodes partial alpha', () => {
    expect(rgbHexToArgb('#000000', 0.5)).toBe('80000000')
  })

  it('clamps alpha into range', () => {
    expect(rgbHexToArgb('#ffffff', 5)).toBe('ffffffff')
    expect(rgbHexToArgb('#ffffff', -1)).toBe('00ffffff')
  })

  it('falls back to white for a malformed colour', () => {
    expect(rgbHexToArgb('bogus', 1)).toBe('ffffffff')
  })

  it('round-trips through argbToRgbHex', () => {
    expect(rgbHexToArgb(argbToRgbHex('80336699'), argbToAlpha('80336699'))).toBe('80336699')
  })
})

describe('argbToCss', () => {
  it('renders rgba with the channels in the right order', () => {
    expect(argbToCss('ff102030')).toBe('rgba(16, 32, 48, 1)')
  })

  it('scales alpha for preview rendering', () => {
    expect(argbToCss('ffffffff', 0.25)).toBe('rgba(255, 255, 255, 0.25)')
  })

  it('falls back to opaque white on garbage', () => {
    expect(argbToCss('nope')).toBe('rgba(255, 255, 255, 1)')
  })
})
