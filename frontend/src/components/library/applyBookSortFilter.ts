// Client-side filter predicate + sort comparator for a system's books,
// mirroring applySystemSortFilter but for the SystemDetailView (which keeps its
// category grouping — so this exposes a predicate + a comparator rather than a
// flat filtered/sorted list).
//
// `genre` is a single-select, matching the systems list's genre filter; `tags`
// is the grouped AND/OR expression from ./tagQuery. `productCode` holds a code
// prefix ("PZO") or a presence sentinel, and matches the start of the code.
// `recent` keeps only books carrying the "new" badge (issue #199).

import { firstValue, matchSpecial } from './specialFilters'
import { matchesTagQuery } from './tagQuery'
import { compareAddedAt, isRecentlyAdded } from '../../utils/recentlyAdded'
import type { Filters } from './FilterModal'

/**
 * The fields of a book the filter and sort read. A type alias (not an
 * interface) so a plain record can be compared with it too.
 */
export type SortableBook = {
  id: string
  title: string
  year?: number | null
  page_count?: number | null
  file_size?: number | null
  product_code?: string | null
  added_at?: string | null
  is_explicit?: boolean | null
  genres?: readonly string[] | null
  tags?: readonly string[] | null
}

type BookCompare = (a: SortableBook, b: SortableBook) => number

const matchValue = (field: unknown, wanted: unknown): boolean => {
  const w = String(wanted).toLowerCase()
  if (Array.isArray(field)) return field.some((v) => String(v).toLowerCase() === w)
  return String(field || '').toLowerCase() === w
}

// `has` also handles the special "no value" / "any value" sentinels.
const has = (field: unknown, wanted: unknown): boolean =>
  wanted ? matchSpecial(field, wanted, matchValue) : true

const matchPrefix = (field: unknown, wanted: unknown): boolean =>
  String(field || '')
    .toUpperCase()
    .startsWith(String(wanted).toUpperCase())

/**
 * The leading letters of a product code - "PZO" for "PZO9001", "TSR" for
 * "TSR 9247" - which is how a publisher's product line reads in a code, so it
 * is what the product-code filter offers. '' for a code with no letter prefix.
 */
export const productCodePrefix = (code: string | null | undefined): string =>
  (/^[A-Za-z]+/.exec(code || '')?.[0] || '').toUpperCase()

/**
 * Build a `book => boolean` predicate from the filter state.
 * @param filters { favorites, explicit, genres, tags, productCode, recent }
 * @param opts { isFavorite: (id) => bool }
 */
export function bookFilterPredicate(
  filters: Filters = {},
  opts: { isFavorite?: (id: string) => boolean } = {}
): (book: SortableBook) => boolean {
  const { isFavorite } = opts
  // `genres` was a multi-select before it was aligned with the systems genre
  // filter, so an old preset can still hold an array — take its first entry.
  const wantGenre = firstValue(filters.genres)
  const search = (filters.search || '').trim().toLowerCase()
  return (book: SortableBook) => {
    if (search && !(book.title || '').toLowerCase().includes(search)) return false
    if (filters.favorites === true && isFavorite && !isFavorite(book.id)) return false
    if (filters.explicit !== undefined && Boolean(book.is_explicit) !== filters.explicit)
      return false
    if (wantGenre && !has(book.genres, wantGenre)) return false
    if (filters.productCode && !matchSpecial(book.product_code, filters.productCode, matchPrefix))
      return false
    if (!matchesTagQuery(filters.tags, book.tags)) return false
    if (filters.recent === true && !isRecentlyAdded(book.added_at)) return false
    return true
  }
}

/** Comparator for a book list given a sort key + order. */
export function bookComparator(sort = 'title', order = 'asc'): BookCompare {
  const dir = order === 'desc' ? -1 : 1
  const cmp: Record<string, BookCompare> = {
    title: (a, b) => a.title.localeCompare(b.title),
    year: (a, b) => (a.year == null ? Infinity : a.year) - (b.year == null ? Infinity : b.year),
    page_count: (a, b) => (a.page_count || 0) - (b.page_count || 0),
    size: (a, b) => (a.file_size || 0) - (b.file_size || 0),
    // Natural order, so PZO10000 follows PZO9001 rather than landing before it.
    // Books without a code sort after those with one, alphabetically.
    product_code: (a, b) => {
      const ca = a.product_code || ''
      const cb = b.product_code || ''
      if (!ca !== !cb) return ca ? -1 : 1
      return (
        ca.localeCompare(cb, undefined, { numeric: true, sensitivity: 'base' }) ||
        a.title.localeCompare(b.title)
      )
    },
  }
  // Date added keeps undated books last whichever way it runs, so it applies
  // the direction itself rather than having the result flipped.
  if (sort === 'added_at') {
    return (a, b) => compareAddedAt(a, b, dir) || a.title.localeCompare(b.title)
  }
  const fn = cmp[sort] || cmp.title
  return (a, b) => dir * fn(a, b)
}
