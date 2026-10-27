// Rank a system's books against a search query by their title + metadata, so a
// system search surfaces matching books (not just page hits) at the top.
//
// Scoring is coarse but intentional: a title match beats a tag match beats a
// description/author/publisher/product code/year match. Every whitespace-separated term must
// appear somewhere for a book to match (AND semantics), matching how users
// expect multi-word queries to narrow results.

/** The book fields the matcher reads. */
export interface MatchableBook {
  title: string
  tags?: string[] | null
  description?: string | null
  authors?: string[] | null
  publisher?: string | null
  product_code?: string | null
  year?: number | string | null
  category?: string | null
}

type Fields = { title: string; tags: string; meta: string }

const fieldsOf = (book: MatchableBook): Fields => ({
  title: (book.title || '').toLowerCase(),
  tags: (book.tags || []).join(' ').toLowerCase(),
  meta: [
    book.description || '',
    (book.authors || []).join(' '),
    book.publisher || '',
    book.product_code || '',
    book.year != null ? String(book.year) : '',
    book.category || '',
  ]
    .join(' ')
    .toLowerCase(),
})

// Per-term weight: title 3, tags 2, other metadata 1; 0 if the term is absent.
const termScore = (f: Fields, term: string) => {
  if (f.title.includes(term)) return 3
  if (f.tags.includes(term)) return 2
  if (f.meta.includes(term)) return 1
  return 0
}

/**
 * Return the books matching every term of `query`, best matches first.
 * @param {Array} books  the system's books
 * @param {string} query the raw search string
 */
export default function matchBooks<B extends MatchableBook>(
  books: readonly B[] | null | undefined,
  query: string | null | undefined
): B[] {
  const terms = (query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (terms.length === 0) return []

  const scored: { book: B; score: number }[] = []
  for (const book of books || []) {
    const f = fieldsOf(book)
    let total = 0
    let missing = false
    for (const term of terms) {
      const s = termScore(f, term)
      if (s === 0) {
        missing = true
        break
      }
      total += s
    }
    if (!missing) scored.push({ book, score: total })
  }

  // Higher score first; stable tie-break on title for deterministic order.
  scored.sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title))
  return scored.map((s) => s.book)
}
