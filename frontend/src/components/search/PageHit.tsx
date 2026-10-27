import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import CardLink from '../CardLink'
import useHoverPrefetch from '../../hooks/useHoverPrefetch'
import { openingPageUrls, type PrefetchableBook } from '../reader/pagePrefetch'
import { cardStyle } from './searchStyles'

// Still JavaScript, so TypeScript would read every destructured prop as required.

interface PageHitProps {
  book: PrefetchableBook
  page: { page_number: number; snippet: string }
}

/**
 * One page hit inside a book's search-result group. A real link: a plain click
 * opens the reader at that page, middle click and ctrl/cmd-click open it in a
 * new tab (issue #313). The current location rides along as `from` state so the
 * reader's back button returns to these results.
 *
 * Resting the pointer on a hit starts loading the page the reader will show,
 * so its render is under way before the click (issue #640). Hits are not
 * prefetched up front: a search returns far more of them than anyone opens.
 */
export default function PageHit({ book, page }: PageHitProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const hoverPrefetch = useHoverPrefetch(() => openingPageUrls(book, page.page_number))
  const pageLabel = t('common.pagePrefixed', { page: page.page_number })
  return (
    <div
      style={{
        ...(cardStyle as CSSProperties),
        borderLeft: '3px solid var(--border)',
        position: 'relative',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
      {...hoverPrefetch}
    >
      <CardLink
        to={`/library/book/${book.id}?page=${page.page_number}`}
        // Includes the query string: these results are identified by `?q=`.
        // Must stay render-fresh — don't memoize this card (see CardLink).
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
