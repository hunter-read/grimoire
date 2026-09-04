import { describe, it, expect } from 'vitest'

import variantLabel, { variantFilename } from './variantLabel'

// The real translator, minus i18n: the helper only ever looks up
// `variants.kind.*`, so echoing the key back with a recognisable shape is
// enough to assert which branch ran.
const t = (key, opts) => {
  if (key === 'variants.mainVersion') return 'Main version'
  const kind = key.replace('variants.kind.', '')
  return (
    {
      gridded: 'Gridded',
      version: 'Version',
      other: 'Other',
      'universal-vtt': 'Universal VTT',
    }[kind] ||
    opts?.defaultValue ||
    kind
  )
}

describe('variantLabel', () => {
  it('names the main entry without consulting its kind', () => {
    expect(variantLabel({ isMain: true, filename: 'map.webp' }, t)).toBe('Main version')
  })

  it('shows the kind and the label together', () => {
    expect(variantLabel({ kind: 'gridded', label: 'v1.2', filename: 'a.webp' }, t)).toBe(
      'Gridded · v1.2'
    )
  })

  it('shows the kind alone when there is no label', () => {
    expect(variantLabel({ kind: 'gridded', label: '', filename: 'a.webp' }, t)).toBe('Gridded')
  })

  it('drops a generic kind that a label already describes', () => {
    // "Version · v1.2" says nothing "v1.2" did not.
    expect(variantLabel({ kind: 'version', label: 'v1.2', filename: 'a.webp' }, t)).toBe('v1.2')
    expect(variantLabel({ kind: 'other', label: 'night', filename: 'a.webp' }, t)).toBe('night')
  })

  it('falls back to the filename when the kind is generic and unlabelled', () => {
    expect(variantLabel({ kind: 'version', label: '', filename: 'map-v2.webp' }, t)).toBe(
      'map-v2.webp'
    )
    expect(variantLabel({ kind: 'other', label: '', filename: 'map-alt.webp' }, t)).toBe(
      'map-alt.webp'
    )
    expect(variantLabel({ kind: '', label: '', filename: 'bare.webp' }, t)).toBe('bare.webp')
  })

  it('names an unlabelled generic version even with no filename to fall back to', () => {
    expect(variantLabel({ kind: 'other', label: '', filename: '' }, t)).toBe('Other')
    expect(variantLabel({ kind: '', label: '', filename: '' }, t)).toBe('Other')
  })

  it('treats a whitespace-only label as no label', () => {
    expect(variantLabel({ kind: 'gridded', label: '   ', filename: 'a.webp' }, t)).toBe('Gridded')
  })

  it('ignores a label that only repeats the filename', () => {
    // What the indexer fills in for an auto-detected pair. Treating it as a real
    // label printed the filename inside the name and again underneath it.
    expect(
      variantLabel({ kind: 'universal-vtt', label: 'map.uvtt', filename: 'map.uvtt' }, t)
    ).toBe('Universal VTT')
  })

  it('falls back to the filename when a generic kind is labelled with it', () => {
    expect(variantLabel({ kind: 'version', label: 'map.uvtt', filename: 'map.uvtt' }, t)).toBe(
      'map.uvtt'
    )
  })

  it('passes an unknown kind through rather than showing a raw key', () => {
    expect(variantLabel({ kind: 'holographic', label: '', filename: 'a.webp' }, t)).toBe(
      'holographic'
    )
  })
})

describe('variantFilename', () => {
  it('gives the filename when the name above does not already say it', () => {
    expect(variantFilename({ kind: 'gridded', label: '', filename: 'a.webp' }, t)).toBe('a.webp')
  })

  it('stays empty when the name above is the filename', () => {
    expect(variantFilename({ kind: 'version', label: '', filename: 'a.webp' }, t)).toBe('')
  })

  it('still gives the filename when a repeated label was discarded', () => {
    // The label is dropped as a non-description, leaving "Universal VTT" as the
    // name - so the filename underneath is the only thing naming the file, and
    // it is shown exactly once rather than suppressed.
    expect(
      variantFilename({ kind: 'universal-vtt', label: 'map.uvtt', filename: 'map.uvtt' }, t)
    ).toBe('map.uvtt')
  })

  it('stays empty when a generic kind fell back to the filename as its name', () => {
    expect(variantFilename({ kind: 'version', label: 'map.uvtt', filename: 'map.uvtt' }, t)).toBe(
      ''
    )
  })

  it('stays empty when there is no filename', () => {
    expect(variantFilename({ kind: 'gridded', label: '', filename: '' }, t)).toBe('')
  })

  it('gives the filename for the main entry, which is named by role only', () => {
    expect(variantFilename({ isMain: true, filename: 'main.webp' }, t)).toBe('main.webp')
  })
})
