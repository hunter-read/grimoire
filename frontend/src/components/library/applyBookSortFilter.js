// Client-side filter predicate + sort comparator for a system's books,
// mirroring applySystemSortFilter but for the SystemDetailView (which keeps its
// category grouping — so this exposes a predicate + a comparator rather than a
// flat filtered/sorted list).
//
// `genre` is a single-select, matching the systems list's genre filter; `tags`
// is the grouped AND/OR expression from ./tagQuery.

import { firstValue, matchSpecial } from './specialFilters'
import { matchesTagQuery } from './tagQuery'

const matchValue = (field, wanted) => {
  const w = String(wanted).toLowerCase()
  if (Array.isArray(field)) return field.some((v) => String(v).toLowerCase() === w)
  return String(field || '').toLowerCase() === w
}

// `has` also handles the special "no value" / "any value" sentinels.
const has = (field, wanted) => (wanted ? matchSpecial(field, wanted, matchValue) : true)

/**
 * Build a `book => boolean` predicate from the filter state.
 * @param filters { favorites, explicit, genres, tags }
 * @param opts { isFavorite: (id) => bool }
 */
export function bookFilterPredicate(filters = {}, opts = {}) {
  const { isFavorite } = opts
  // `genres` was a multi-select before it was aligned with the systems genre
  // filter, so an old preset can still hold an array — take its first entry.
  const wantGenre = firstValue(filters.genres)
  const search = (filters.search || '').trim().toLowerCase()
  return (book) => {
    if (search && !(book.title || '').toLowerCase().includes(search)) return false
    if (filters.favorites === true && isFavorite && !isFavorite(book.id)) return false
    if (filters.explicit !== undefined && Boolean(book.is_explicit) !== filters.explicit)
      return false
    if (wantGenre && !has(book.genres, wantGenre)) return false
    if (!matchesTagQuery(filters.tags, book.tags)) return false
    return true
  }
}

/** Comparator for a book list given a sort key + order. */
export function bookComparator(sort = 'title', order = 'asc') {
  const dir = order === 'desc' ? -1 : 1
  const cmp = {
    title: (a, b) => a.title.localeCompare(b.title),
    year: (a, b) => (a.year == null ? Infinity : a.year) - (b.year == null ? Infinity : b.year),
    page_count: (a, b) => (a.page_count || 0) - (b.page_count || 0),
    size: (a, b) => (a.file_size || 0) - (b.file_size || 0),
  }
  const fn = cmp[sort] || cmp.title
  return (a, b) => dir * fn(a, b)
}
