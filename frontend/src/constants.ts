import {
  LuBook,
  LuBookOpen,
  LuScroll,
  LuClipboard,
  LuMap,
  LuFileText,
  LuWrench,
  LuPackage,
  LuNewspaper,
  LuShield,
  LuTriangleAlert,
  LuTarget,
  LuFlag,
  LuTable,
  LuPaintbrush,
  LuFeather,
} from 'react-icons/lu'
import type { IconType } from 'react-icons'

/** The fields these helpers read from a book record (list item or detail). */
interface BookLike {
  filename?: string | null
  filepath?: string | null
  mime_type?: string | null
}

export const CATEGORY_ORDER = [
  'core',
  'starter-set',
  'supplement',
  'adventure',
  'handout',
  'character-sheet',
  'map',
  'magazine',
  'homebrew',
]

/**
 * The categories a wargame book (one in the armory) is filed under, in shelf
 * order. A separate vocabulary from the role-playing one: "campaign" is a
 * campaign book here, where a role-playing folder of that name holds
 * adventures (WARGAME_CATEGORY_MAP in backend/indexer/constants.py).
 */
export const WARGAME_CATEGORY_ORDER = [
  'core',
  'army-book',
  'starter-set',
  'supplement',
  'errata',
  'mission-pack',
  'campaign',
  'unit-reference',
  'magazine',
  'painting-guide',
  'lore',
]

/** The category order for a book or system of this game type. */
export function categoryOrderFor(gameType?: string | null): string[] {
  return gameType === 'wargame' ? WARGAME_CATEGORY_ORDER : CATEGORY_ORDER
}

export const CATEGORY_LABELS: Record<string, string> = {
  core: 'Core Rulebooks',
  'starter-set': 'Starter Set',
  supplement: 'Supplements & Sourcebooks',
  adventure: 'Adventures & Modules',
  'character-sheet': 'Character Sheets',
  map: 'Maps',
  handout: 'Handouts & Reference',
  magazine: 'Magazines & Zines',
  homebrew: 'Homebrew',
  // Wargames (the armory)
  'army-book': 'Army Books',
  errata: 'Rules Updates & Errata',
  'mission-pack': 'Mission Packs',
  campaign: 'Campaign Books',
  'unit-reference': 'Unit References',
  'painting-guide': 'Painting & Hobby',
  lore: 'Lore & Fiction',
}

export const CATEGORY_ICONS: Record<string, IconType> = {
  core: LuBook,
  'starter-set': LuPackage,
  supplement: LuBookOpen,
  adventure: LuScroll,
  'character-sheet': LuClipboard,
  map: LuMap,
  handout: LuFileText,
  magazine: LuNewspaper,
  homebrew: LuWrench,
  'army-book': LuShield,
  errata: LuTriangleAlert,
  'mission-pack': LuTarget,
  campaign: LuFlag,
  'unit-reference': LuTable,
  'painting-guide': LuPaintbrush,
  lore: LuFeather,
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
export function isComicBook(book: BookLike | null | undefined): boolean {
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
export function isArchiveBook(book: BookLike | null | undefined): boolean {
  return !!book && ARCHIVE_MIME_TYPES.has(book.mime_type ?? '') && !isComicBook(book)
}

// MIME types for plain-text books (.txt/.md/.rtf) rendered as formatted text
// rather than as page images (issue #200).
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'application/rtf'])

/** True when a book record is a plain-text document. */
export function isTextBook(book: BookLike | null | undefined): boolean {
  return !!book && TEXT_MIME_TYPES.has(book.mime_type ?? '')
}

/**
 * True when a book is a single image file shown without paging.
 *
 * DjVu is deliberately excluded despite its `image/vnd.djvu` MIME type: it is a
 * multi-page scanned document that the backend renders page by page like a PDF,
 * so treating it as a flat image would strip its paging (issue #373).
 */
export function isSingleImageBook(book: BookLike | null | undefined): boolean {
  return !!book && !!book.mime_type?.startsWith('image/') && book.mime_type !== 'image/vnd.djvu'
}

/**
 * True when a media item (map/token/audio) is an archive. Unlike books — which
 * are matched on their stored `mime_type` — media rows carry no MIME column, so
 * the backend serialises an explicit `is_archive` flag (issue #250).
 */
export function isArchiveMedia(item: { is_archive?: boolean | null } | null | undefined): boolean {
  return !!item && !!item.is_archive
}

/**
 * Create a URL-safe slug from a name. Mirrors `slugify` in `backend/indexer/categories.py`
 * so custom category names entered in the UI match what the backend produces.
 */
export function slugify(name: string | null | undefined): string {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Friendly label for a category slug, falling back to the slug itself. */
export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] || slug
}
