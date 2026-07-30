// Client-side filter predicate + sort comparator for a system's books,
// mirroring applySystemSortFilter but for the SystemDetailView (which keeps its
// category grouping — so this exposes a predicate + a comparator rather than a
// flat filtered/sorted list).

const hasAll = (field, wanted) => {
  const vals = (field || []).map((v) => String(v).toLowerCase())
  return wanted.every((w) => vals.includes(w))
}

/**
 * Build a `book => boolean` predicate from the filter state.
 * @param filters { favorites, explicit, genres:[], tags:[] }
 * @param opts { isFavorite: (id) => bool }
 */
export function bookFilterPredicate(filters = {}, opts = {}) {
  const { isFavorite } = opts
  const wantGenres = Array.isArray(filters.genres) ? filters.genres.map((g) => g.toLowerCase()) : []
  const wantTags = Array.isArray(filters.tags) ? filters.tags.map((tg) => tg.toLowerCase()) : []
  const search = (filters.search || '').trim().toLowerCase()
  return (book) => {
    if (search && !(book.title || '').toLowerCase().includes(search)) return false
    if (filters.favorites === true && isFavorite && !isFavorite(book.id)) return false
    if (filters.explicit !== undefined && Boolean(book.is_explicit) !== filters.explicit)
      return false
    if (wantGenres.length && !hasAll(book.genres, wantGenres)) return false
    if (wantTags.length && !hasAll(book.tags, wantTags)) return false
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
