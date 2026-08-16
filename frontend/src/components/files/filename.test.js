import { describe, it, expect } from 'vitest'
import { splitExtension, joinExtension } from './filename'

describe('splitExtension', () => {
  it('splits a simple extension', () => {
    expect(splitExtension('Monster Manual.pdf')).toEqual({
      stem: 'Monster Manual',
      ext: '.pdf',
    })
  })

  it('keeps multi-part archive suffixes together', () => {
    // Splitting on the last dot would offer ".gz" and let the user rewrite
    // "pack.tar" — changing the archive type Grimoire infers.
    expect(splitExtension('map-pack.tar.gz')).toEqual({ stem: 'map-pack', ext: '.tar.gz' })
    expect(splitExtension('pack.tar.bz2')).toEqual({ stem: 'pack', ext: '.tar.bz2' })
  })

  it('treats a folder as all stem', () => {
    expect(splitExtension('D&D 5e', true)).toEqual({ stem: 'D&D 5e', ext: '' })
  })

  it('treats a dotted folder name as all stem', () => {
    // Folders legitimately contain dots ("Vol.2"); none of it is an extension.
    expect(splitExtension('Vol.2', true)).toEqual({ stem: 'Vol.2', ext: '' })
  })

  it('handles a file with no extension', () => {
    expect(splitExtension('README')).toEqual({ stem: 'README', ext: '' })
  })

  it('treats a leading dot as a hidden name, not an extension', () => {
    expect(splitExtension('.nsfw')).toEqual({ stem: '.nsfw', ext: '' })
  })

  it('handles a trailing dot without producing an empty extension', () => {
    expect(splitExtension('weird.')).toEqual({ stem: 'weird.', ext: '' })
  })

  it('matches the extension case-insensitively but preserves it', () => {
    expect(splitExtension('BOOK.PDF')).toEqual({ stem: 'BOOK', ext: '.PDF' })
  })

  it('splits on the last dot for multi-dot names', () => {
    expect(splitExtension('D&D 3.5 Players Handbook.pdf')).toEqual({
      stem: 'D&D 3.5 Players Handbook',
      ext: '.pdf',
    })
  })
})

describe('joinExtension', () => {
  it('reattaches the extension and trims the stem', () => {
    expect(joinExtension('  Bestiary  ', '.pdf')).toBe('Bestiary.pdf')
  })

  it('returns the bare stem when there is no extension', () => {
    expect(joinExtension('Adventures', '')).toBe('Adventures')
  })

  it('round-trips an unchanged name', () => {
    const name = 'map-pack.tar.gz'
    const { stem, ext } = splitExtension(name)
    expect(joinExtension(stem, ext)).toBe(name)
  })
})
