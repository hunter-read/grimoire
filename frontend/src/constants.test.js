import { describe, it, expect } from 'vitest'
import { isArchiveBook, isArchiveMedia, CATEGORY_ICONS } from './constants'

describe('isArchiveBook', () => {
  it('returns true for zip archives', () => {
    expect(isArchiveBook({ mime_type: 'application/zip' })).toBe(true)
  })

  it('returns true for comic-book archives', () => {
    expect(isArchiveBook({ mime_type: 'application/vnd.comicbook+zip' })).toBe(true)
    expect(isArchiveBook({ mime_type: 'application/vnd.comicbook-rar' })).toBe(true)
  })

  it('returns true for rar / 7z / tar / gzip / bzip2', () => {
    expect(isArchiveBook({ mime_type: 'application/vnd.rar' })).toBe(true)
    expect(isArchiveBook({ mime_type: 'application/x-7z-compressed' })).toBe(true)
    expect(isArchiveBook({ mime_type: 'application/x-tar' })).toBe(true)
    expect(isArchiveBook({ mime_type: 'application/gzip' })).toBe(true)
    expect(isArchiveBook({ mime_type: 'application/x-bzip2' })).toBe(true)
  })

  it('returns false for pdf and images', () => {
    expect(isArchiveBook({ mime_type: 'application/pdf' })).toBe(false)
    expect(isArchiveBook({ mime_type: 'image/png' })).toBe(false)
  })

  it('returns false for null / undefined / missing mime', () => {
    expect(isArchiveBook(null)).toBe(false)
    expect(isArchiveBook(undefined)).toBe(false)
    expect(isArchiveBook({})).toBe(false)
  })
})

describe('isArchiveMedia', () => {
  it('returns true when the backend flags the item as an archive', () => {
    expect(isArchiveMedia({ filename: 'pack.zip', is_archive: true })).toBe(true)
  })

  it('returns false for a regular media item', () => {
    expect(isArchiveMedia({ filename: 'cave.png', is_archive: false })).toBe(false)
  })

  it('returns false when the flag is absent or the item is nullish', () => {
    expect(isArchiveMedia({ filename: 'cave.png' })).toBe(false)
    expect(isArchiveMedia(null)).toBe(false)
    expect(isArchiveMedia(undefined)).toBe(false)
  })
})

describe('CATEGORY_ICONS', () => {
  it('has an icon for the core category', () => {
    expect(CATEGORY_ICONS.core).toBeTruthy()
  })
})
