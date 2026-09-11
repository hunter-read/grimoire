import { describe, it, expect } from 'vitest'
import { canExportUvtt, editTargets, isVttFile, linkedVtt } from './editTargets'

const raster = (over = {}) => ({ id: 'm1', filename: 'keep.png', variants: [], ...over })

describe('isVttFile', () => {
  it('matches both Universal VTT extensions, case-insensitively', () => {
    expect(isVttFile({ filename: 'a.uvtt' })).toBe(true)
    expect(isVttFile({ filename: 'a.DD2VTT' })).toBe(true)
    expect(isVttFile({ filename: 'a.png' })).toBe(false)
  })

  it('tolerates a missing filename', () => {
    expect(isVttFile({})).toBe(false)
    expect(isVttFile(null)).toBe(false)
  })
})

describe('linkedVtt', () => {
  it('finds a sibling by its categorised kind', () => {
    const map = raster({
      variants: [
        { id: 'm1', kind: '', filename: 'keep.png' },
        { id: 'v1', kind: 'universal-vtt', filename: 'anything.dat' },
      ],
    })
    // The link is what pairs them, not the name: the duplicate manager lets a
    // user pair two files whatever they are called.
    expect(linkedVtt(map).id).toBe('v1')
  })

  it('falls back to the extension when the link carries no kind', () => {
    const map = raster({ variants: [{ id: 'v1', kind: '', filename: 'keep.uvtt' }] })
    expect(linkedVtt(map).id).toBe('v1')
  })

  it('never returns the map itself', () => {
    const map = { id: 'm1', filename: 'keep.uvtt', variants: [{ id: 'm1', filename: 'keep.uvtt' }] }
    expect(linkedVtt(map)).toBeNull()
  })

  it('is null when the family holds no Universal VTT', () => {
    const map = raster({ variants: [{ id: 'v1', kind: '', filename: 'keep-hi-res.png' }] })
    expect(linkedVtt(map)).toBeNull()
  })
})

describe('editTargets', () => {
  it('offers the image alone for a plain raster map', () => {
    expect(editTargets(raster())).toEqual([{ id: 'm1', kind: 'image', filename: 'keep.png' }])
  })

  it('offers both halves of a linked pair, image first', () => {
    const map = raster({ variants: [{ id: 'v1', kind: 'universal-vtt', filename: 'keep.uvtt' }] })
    // A pair is exactly the case where only the user knows which they mean, so
    // both are offered rather than one being picked for them.
    expect(editTargets(map)).toEqual([
      { id: 'm1', kind: 'image', filename: 'keep.png' },
      { id: 'v1', kind: 'vtt', filename: 'keep.uvtt' },
    ])
  })

  it('offers the file itself for a standalone .uvtt', () => {
    const map = { id: 'v1', filename: 'tavern.uvtt', media_kind: 'vtt', variants: [] }
    expect(editTargets(map)).toEqual([{ id: 'v1', kind: 'vtt', filename: 'tavern.uvtt' }])
  })

  it.each([
    ['a PDF', { is_pdf: true }],
    ['a video', { media_kind: 'video' }],
    ['an archive', { media_kind: 'archive' }],
    ['an archive flagged on the row', { is_archive: true }],
  ])('offers nothing for %s', (_label, over) => {
    // None of these is a single raster to calibrate a grid against.
    expect(editTargets(raster(over))).toEqual([])
  })

  it('is empty for no map at all', () => {
    expect(editTargets(null)).toEqual([])
  })
})

describe('canExportUvtt', () => {
  it('allows a plain raster map', () => {
    expect(canExportUvtt(raster())).toBe(true)
  })

  it('refuses a raster already paired with a .uvtt', () => {
    // Our generated file would carry no walls while the linked one does.
    const map = raster({ variants: [{ id: 'v1', kind: 'universal-vtt', filename: 'k.uvtt' }] })
    expect(canExportUvtt(map)).toBe(false)
  })

  it('allows the .uvtt half of a pair', () => {
    const map = {
      id: 'v1',
      filename: 'keep.uvtt',
      media_kind: 'vtt',
      variants: [{ id: 'm1', kind: '', filename: 'keep.png' }],
    }
    // This is the half holding the geometry, so exporting it is the point.
    expect(canExportUvtt(map)).toBe(true)
  })

  it('refuses formats with no raster', () => {
    expect(canExportUvtt(raster({ is_pdf: true }))).toBe(false)
    expect(canExportUvtt(raster({ media_kind: 'video' }))).toBe(false)
  })
})
