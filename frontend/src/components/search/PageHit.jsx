import { useTranslation } from 'react-i18next'
import useLinkProps from '../../hooks/useLinkProps'
import { cardStyle } from './searchStyles'

/**
 * One page hit inside a book's search-result group. Behaves like a link: a plain
 * click opens the reader at that page, middle click and ctrl/cmd-click open it
 * in a new tab (issue #313).
 */
export default function PageHit({ bookId, page, onOpen }) {
  const { t } = useTranslation()
  const linkProps = useLinkProps(`/library/book/${bookId}?page=${page.page_number}`, onOpen)
  return (
    <div
      {...linkProps}
      style={{ ...cardStyle, borderLeft: '3px solid var(--border)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {t('common.pagePrefixed', { page: page.page_number })}
        </span>
      </div>
      <div
        style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}
        dangerouslySetInnerHTML={{ __html: page.snippet }}
      />
    </div>
  )
}
