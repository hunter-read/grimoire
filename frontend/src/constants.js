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

/** True when a book record is an archive file (zip/rar/7z/tar/comic-book). */
export function isArchiveBook(book) {
  return !!book && ARCHIVE_MIME_TYPES.has(book.mime_type)
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
