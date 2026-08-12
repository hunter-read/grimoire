import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { relativeLuminance, contrastRatio, meetsContrast, AA_NORMAL } from './contrast'

describe('contrast maths', () => {
  it('computes the extremes of the luminance range', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('expands three-digit hex', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(relativeLuminance('#ffffff'), 10)
  })

  it('returns null for a value it cannot parse', () => {
    expect(relativeLuminance('rgb(1,2,3)')).toBeNull()
    expect(contrastRatio('#fff', 'nonsense')).toBeNull()
  })

  it('puts black on white at the maximum 21:1', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 2)
  })

  it('is order-independent', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 10)
  })

  it('reports AA pass/fail against the threshold', () => {
    expect(meetsContrast('#000', '#fff')).toBe(true)
    expect(meetsContrast('#777', '#888')).toBe(false)
    expect(meetsContrast('#000', '#fff', 25)).toBe(false)
  })
})

/**
 * Guard the shipped palettes.
 *
 * These read the real index.css rather than a copy, so a future palette tweak
 * that drops a colour below AA fails here instead of shipping. This caught the
 * light-mode accent at 4.31:1 against --bg-deep during development.
 */
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

function paletteFor(selector) {
  const block = css.slice(css.indexOf(selector))
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'))
  const tokens = {}
  for (const [, name, value] of body.matchAll(/--p-([\w-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim()
  }
  return tokens
}

const SURFACES = ['bg-deep', 'bg-panel', 'bg-card']
const FOREGROUNDS = [
  'text',
  'text-dim',
  'text-muted',
  'accent',
  'accent-dim',
  'accent-bright',
  'accent-alt',
  'danger',
  'success',
  'warning',
  'blue',
  'red',
  'green',
  'type-book',
  'type-map',
  'type-token',
  'type-audio',
  'type-file',
]

describe.each([
  ['grimoire dark', ":root,\n:root[data-theme='dark']"],
  ['grimoire light', ":root[data-theme='light']"],
  // Codex ships as a built-in theme, so it is held to the same bar as the
  // default palettes rather than being exempt for being a "skin".
  ['codex dark', ":root[data-app-mode='codex'],\n:root[data-app-mode='codex'][data-theme='dark']"],
  ['codex light', ":root[data-app-mode='codex'][data-theme='light']"],
])('%s palette', (_mode, selector) => {
  const palette = paletteFor(selector)

  it('defines every surface and foreground token', () => {
    for (const name of [...SURFACES, ...FOREGROUNDS]) {
      expect(palette[name], `missing --p-${name}`).toBeTruthy()
    }
  })

  it.each(FOREGROUNDS)('%s clears AA on every surface', (fg) => {
    for (const bg of SURFACES) {
      const ratio = contrastRatio(palette[fg], palette[bg])
      expect(
        ratio,
        `--p-${fg} (${palette[fg]}) on --p-${bg} (${palette[bg]}) is ${ratio?.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  it('keeps on-accent text legible against the accent fill', () => {
    const ratio = contrastRatio(palette['on-accent'], palette.accent)
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('keeps on-danger text legible against the danger fill', () => {
    const ratio = contrastRatio(palette['on-danger'], palette['danger-fill'])
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  // The content-type hues carry meaning, so two of them resolving to near the
  // same colour would make a map indistinguishable from a book.
  it('keeps the content-type hues distinct from one another', () => {
    const types = ['type-book', 'type-map', 'type-token', 'type-audio', 'type-file']
    for (let i = 0; i < types.length; i += 1) {
      for (let j = i + 1; j < types.length; j += 1) {
        expect(
          palette[types[i]].toLowerCase(),
          `${types[i]} and ${types[j]} are the same colour`
        ).not.toBe(palette[types[j]].toLowerCase())
      }
    }
  })
})
