import { CATEGORY_ORDER } from '../../constants'

/**
 * Order a system's books for the cover picker.
 *
 * A system can hold hundreds of books, and the cover is nearly always one of
 * the core rulebooks — so those come first, then the rest of the categories in
 * the library's usual order, then anything uncategorised. Within a category,
 * books sort by title so the order is stable between renders.
 *
 * The currently selected cover is pinned to the very front, so it stays visible
 * rather than disappearing behind a "load more" once the list is paged.
 *
 * Books with no thumbnail are dropped — there is nothing to show for them.
 */
export function sortForCoverPicker(books, selectedId = null) {
  const withThumbnails = (books || []).filter((b) => b?.has_thumbnail)

  const rank = (book) => {
    const index = CATEGORY_ORDER.indexOf(book.category)
    // Unknown or missing categories sort after every known one.
    return index === -1 ? CATEGORY_ORDER.length : index
  }

  return [...withThumbnails].sort((a, b) => {
    if (a.id === selectedId) return -1
    if (b.id === selectedId) return 1

    const byCategory = rank(a) - rank(b)
    if (byCategory !== 0) return byCategory

    return String(a.title || '').localeCompare(String(b.title || ''))
  })
}
