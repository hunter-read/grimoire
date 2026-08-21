import { describe, it, expect } from 'vitest'
import {
  isArchiveBook,
  isArchiveMedia,
  isComicBook,
  isSingleImageBook,
  isTextBook,
  CATEGORY_ICONS,
} from './constants'

describe('isArchiveBook', () => {
  it('returns true for zip archives', () => {
    expect(isArchiveBook({ mime_type: 'application/zip' })).toBe(true)
  })

  it('treats a comic-book archive as readable, not as an opaque download', () => {
    // Issue #180: comics page in the reader, so they must not be routed to the
    // "archive, download it instead" screen.
    expect(
      isArchiveBook({ mime_type: 'application/vnd.comicbook+zip', filename: 'issue1.cbz' })
    ).toBe(false)
    expect(
      isArchiveBook({ mime_type: 'application/x-7z-compressed', filename: 'issue1.cb7' })
    ).toBe(false)
  })

  it('still treats a plain 7z/tar as an archive even though comics share its MIME', () => {
    expect(isArchiveBook({ mime_type: 'application/x-7z-compressed', filename: 'a.7z' })).toBe(true)
    expect(isArchiveBook({ mime_type: 'application/x-tar', filename: 'a.tar' })).toBe(true)
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

describe('isComicBook', () => {
  it('matches every comic-archive extension, case-insensitively', () => {
    expect(isComicBook({ filename: 'a.cbz' })).toBe(true)
    expect(isComicBook({ filename: 'a.cbr' })).toBe(true)
    expect(isComicBook({ filename: 'a.cb7' })).toBe(true)
    expect(isComicBook({ filename: 'A.CBT' })).toBe(true)
  })

  it('falls back to filepath when filename is absent', () => {
    expect(isComicBook({ filepath: '/lib/books/a.cbz' })).toBe(true)
  })

  it('returns false for plain archives and other books', () => {
    expect(isComicBook({ filename: 'a.7z' })).toBe(false)
    expect(isComicBook({ filename: 'a.pdf' })).toBe(false)
    expect(isComicBook(null)).toBe(false)
    expect(isComicBook({})).toBe(false)
  })
})

describe('isTextBook', () => {
  it('matches the plain-text book formats', () => {
    expect(isTextBook({ mime_type: 'text/plain' })).toBe(true)
    expect(isTextBook({ mime_type: 'text/markdown' })).toBe(true)
    expect(isTextBook({ mime_type: 'application/rtf' })).toBe(true)
  })

  it('returns false for other formats', () => {
    expect(isTextBook({ mime_type: 'application/pdf' })).toBe(false)
    expect(isTextBook(null)).toBe(false)
  })
})

describe('isSingleImageBook', () => {
  it('matches ordinary image books', () => {
    expect(isSingleImageBook({ mime_type: 'image/png' })).toBe(true)
    expect(isSingleImageBook({ mime_type: 'image/jpeg' })).toBe(true)
  })

  it('excludes DjVu, which is a paged document despite its image MIME', () => {
    // Issue #373: DjVu renders page by page like a PDF.
    expect(isSingleImageBook({ mime_type: 'image/vnd.djvu' })).toBe(false)
  })

  it('returns false for non-images', () => {
    expect(isSingleImageBook({ mime_type: 'application/pdf' })).toBe(false)
    expect(isSingleImageBook(null)).toBe(false)
  })
})
