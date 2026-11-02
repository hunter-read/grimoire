import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Schema } from '../../api'
import { useTranslation } from 'react-i18next'
import BookRow from './BookRow'
import BookDetailsModal from './BookDetailsModal'
import SystemPageHit from './SystemPageHit'

/**
 * The search-results view shown inside SystemDetailView when a full-text search
 * is active: matching books (title/metadata hits) above the full-text page hits,
 * plus the empty state. Extracted from SystemDetailView (issue #152); rendering
 * is unchanged.
 *
 * Props:
 *   searchResults      – { query, results: [...] } from the search API
 *   matchedBooks       – books whose title/metadata match (rendered first)
 *   booksContainerStyle– grid/list style shared with the category grid
 *   card, compact      – view-mode layout flags for BookRow
 */
export interface SystemSearchResultsProps {
  /** The active search, or null when there is none (renders nothing). */
  searchResults: Pick<Schema<'SearchResponse'>, 'query' | 'results'> | null
  matchedBooks: Schema<'BookOut'>[]
  booksContainerStyle?: CSSProperties
  card?: boolean
  compact?: boolean
}

export default function SystemSearchResults({
  searchResults,
  matchedBooks,
  booksContainerStyle,
  card,
  compact,
}: SystemSearchResultsProps) {
  const { t } = useTranslation()
  // The book whose read-only details view is open, if any.
  const [detailsBook, setDetailsBook] = useState<Schema<'BookOut'> | null>(null)
  if (!searchResults) return null

  return (
    <>
      {/* Matching books (title / metadata) — shown above the page hits so a
          search finds the book itself, not just the pages inside it. */}
      {matchedBooks.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          {/* Headings, so a screen reader can jump between the two result sets. */}
          <h2 style={resultHeadingStyle}>
            {t('systemDetail.matchingBooks', { count: matchedBooks.length })}
          </h2>
          <ul role="list" className="card-list" style={booksContainerStyle}>
            {matchedBooks.map((book) => (
              <li key={book.id}>
                <BookRow
                  book={book}
                  card={card}
                  compact={compact}
                  onEdit={null}
                  onDetails={() => setDetailsBook(book)}
                  editing={false}
                  bulkMode={false}
                  selected={false}
                  onToggle={() => {}}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {detailsBook && <BookDetailsModal book={detailsBook} onClose={() => setDetailsBook(null)} />}

      {/* Nothing matched — neither a book nor a page. */}
      {matchedBooks.length === 0 && searchResults.results.length === 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
            {t('systemDetail.noResultsFound')}
          </div>
        </div>
      )}

      {/* Full-text page results */}
      {searchResults.results.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={resultHeadingStyle}>
            {t('systemDetail.resultsInPages', {
              count: searchResults.results.length,
              query: searchResults.query,
            })}
          </h2>
          {searchResults.results.map((r, i) => (
            <SystemPageHit key={i} result={r} />
          ))}
        </div>
      )}
    </>
  )
}

// The result headings keep the quiet caption look they had as plain text.
const resultHeadingStyle: CSSProperties = {
  fontSize: 14,
  fontFamily: 'inherit',
  fontWeight: 400,
  letterSpacing: 'normal',
  color: 'var(--text-muted)',
  margin: '0 0 12px',
}
