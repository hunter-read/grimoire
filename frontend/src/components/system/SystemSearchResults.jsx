import { useTranslation } from 'react-i18next'
import BookRow from './BookRow'
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
 *   onOpenBook         – (book) => void
 *   onOpenPage         – (result) => void  (navigates to the page hit)
 */
export default function SystemSearchResults({
  searchResults,
  matchedBooks,
  booksContainerStyle,
  card,
  compact,
  onOpenBook,
  onOpenPage,
}) {
  const { t } = useTranslation()
  if (!searchResults) return null

  return (
    <>
      {/* Matching books (title / metadata) — shown above the page hits so a
          search finds the book itself, not just the pages inside it. */}
      {matchedBooks.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
            {t('systemDetail.matchingBooks', { count: matchedBooks.length })}
          </div>
          <div style={booksContainerStyle}>
            {matchedBooks.map((book) => (
              <BookRow
                key={book.id}
                book={book}
                card={card}
                compact={compact}
                onOpen={() => onOpenBook(book)}
                onEdit={null}
                editing={false}
                bulkMode={false}
                selected={false}
                onToggle={() => {}}
              />
            ))}
          </div>
        </div>
      )}

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
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
            {t('systemDetail.resultsInPages', {
              count: searchResults.results.length,
              query: searchResults.query,
            })}
          </div>
          {searchResults.results.map((r, i) => (
            <SystemPageHit key={i} result={r} onOpen={() => onOpenPage(r)} />
          ))}
        </div>
      )}
    </>
  )
}
