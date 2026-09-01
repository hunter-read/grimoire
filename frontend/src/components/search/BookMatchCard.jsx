import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import CardLink from '../CardLink'
import ResultThumb from './ResultThumb'
import TagList from './TagList'
import { cardStyle } from './searchStyles'

/**
 * A book matched on its own title/metadata rather than its page text (issue #343).
 *
 * Pinned above the page-hit groups, and deliberately *not* expandable: this row
 * answers "do I own this book?", so it carries the cover and the identifying
 * metadata and links straight to the book. A book that also matched on content
 * still shows its page hits below, in the normal grouped list.
 */
export default function BookMatchCard({ book }) {
  const { t } = useTranslation()
  const location = useLocation()

  // The line under the title: system, authors, year — whichever the book has.
  const meta = [book.game_system, book.authors?.join(', '), book.year].filter(Boolean).join(' · ')

  return (
    <div
      style={{ ...cardStyle, position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
    >
      <CardLink
        to={`/library/book/${book.id}`}
        // These results are identified by `?q=`, so the query string rides
        // along and the reader's back button returns here.
        state={{ from: location.pathname + location.search }}
        label={book.title}
      />
      <ResultThumb type="book" id={book.id} hasThumbnail={book.has_thumbnail} alt="" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{book.title}</div>
        {meta && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>{meta}</div>
        )}
        {book.tags?.length > 0 && <TagList tags={book.tags} />}
      </div>
      <span
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--gold-dim)',
          flexShrink: 0,
        }}
      >
        {t('search.titleMatch')}
      </span>
    </div>
  )
}
