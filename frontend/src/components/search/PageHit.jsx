import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import CardLink from '../CardLink'
import { cardStyle } from './searchStyles'

/**
 * One page hit inside a book's search-result group. A real link: a plain click
 * opens the reader at that page, middle click and ctrl/cmd-click open it in a
 * new tab (issue #313). The current location rides along as `from` state so the
 * reader's back button returns to these results.
 */
export default function PageHit({ bookId, page }) {
  const { t } = useTranslation()
  const location = useLocation()
  const pageLabel = t('common.pagePrefixed', { page: page.page_number })
  return (
    <div
      style={{ ...cardStyle, borderLeft: '3px solid var(--border)', position: 'relative' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
    >
      <CardLink
        to={`/library/book/${bookId}?page=${page.page_number}`}
        state={{ from: location.pathname + location.search }}
        label={pageLabel}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{pageLabel}</span>
      </div>
      <div
        style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}
        dangerouslySetInnerHTML={{ __html: page.snippet }}
      />
    </div>
  )
}
