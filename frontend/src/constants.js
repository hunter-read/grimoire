import {
  LuBook,
  LuBookOpen,
  LuScroll,
  LuClipboard,
  LuMap,
  LuFileText,
  LuWrench,
  LuPackage,
} from 'react-icons/lu'

export const CATEGORY_ORDER = [
  'core',
  'starter-set',
  'supplement',
  'adventure',
  'handout',
  'character-sheet',
  'map',
  'homebrew',
]

export const CATEGORY_LABELS = {
  core: 'Core Rulebooks',
  'starter-set': 'Starter Set',
  supplement: 'Supplements & Sourcebooks',
  adventure: 'Adventures & Modules',
  'character-sheet': 'Character Sheets',
  map: 'Maps',
  handout: 'Handouts & Reference',
  homebrew: 'Homebrew',
}

export const CATEGORY_ICONS = {
  core: LuBook,
  'starter-set': LuPackage,
  supplement: LuBookOpen,
  adventure: LuScroll,
  'character-sheet': LuClipboard,
  map: LuMap,
  handout: LuFileText,
  homebrew: LuWrench,
}

// MIME types for archive files that are shown alongside books but have no
// viewable pages — clicking one downloads it instead of opening the reader.
const ARCHIVE_MIME_TYPES = new Set([
  'application/zip',
  'application/vnd.comicbook+zip',
  'application/vnd.rar',
  'application/vnd.comicbook-rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-bzip2',
])

// Comic-book archives are readable page-by-page (issue #180), so they are the
// one archive family that opens in the reader. Matched on file extension, not
// MIME: .cb7/.cbt share the generic 7z/tar MIME types with ordinary archives,
// so only the extension distinguishes a comic from a plain .7z.
const COMIC_EXTENSIONS = ['.cbz', '.cbr', '.cb7', '.cbt']

/** True when a book record is a comic-book archive read as a page sequence. */
export function isComicBook(book) {
  const name = book?.filename || book?.filepath || ''
  return COMIC_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))
}

/**
 * True when a book is an archive with no viewable pages.
 *
 * Comic archives are excluded: they page in the reader like any other book, so
 * treating them as opaque downloads is exactly the behaviour issue #180 asked
 * us to change.
 */
export function isArchiveBook(book) {
  return !!book && ARCHIVE_MIME_TYPES.has(book.mime_type) && !isComicBook(book)
}

// MIME types for plain-text books (.txt/.md/.rtf) rendered as formatted text
// rather than as page images (issue #200).
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'application/rtf'])

/** True when a book record is a plain-text document. */
export function isTextBook(book) {
  return !!book && TEXT_MIME_TYPES.has(book.mime_type)
}

/**
 * True when a book is a single image file shown without paging.
 *
 * DjVu is deliberately excluded despite its `image/vnd.djvu` MIME type: it is a
 * multi-page scanned document that the backend renders page by page like a PDF,
 * so treating it as a flat image would strip its paging (issue #373).
 */
export function isSingleImageBook(book) {
  return !!book && !!book.mime_type?.startsWith('image/') && book.mime_type !== 'image/vnd.djvu'
}

/**
 * True when a media item (map/token/audio) is an archive. Unlike books — which
 * are matched on their stored `mime_type` — media rows carry no MIME column, so
 * the backend serialises an explicit `is_archive` flag (issue #250).
 */
export function isArchiveMedia(item) {
  return !!item && !!item.is_archive
}

/**
 * Create a URL-safe slug from a name. Mirrors `slugify` in `backend/indexer.py`
 * so custom category names entered in the UI match what the backend produces.
 */
export function slugify(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Friendly label for a category slug, falling back to the slug itself. */
export function categoryLabel(slug) {
  return CATEGORY_LABELS[slug] || slug
}
