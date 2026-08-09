import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import CardLink from '../CardLink'

/**
 * One full-text page hit in the in-system search results. A real link: a plain
 * click opens the reader at that page, middle click and ctrl/cmd-click open it
 * in a new tab (issue #313). The current location rides along as `from` state
 * so the reader's back button returns here.
 */
export default function SystemPageHit({ result }) {
  const { t } = useTranslation()
  const location = useLocation()
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        marginBottom: 8,
        cursor: 'pointer',
        position: 'relative',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
    >
      <CardLink
        to={`/library/book/${result.id}?page=${result.page_number}`}
        // Must stay render-fresh — don't memoize this card (see CardLink).
        state={{ from: location.pathname }}
        label={`${result.title} — ${t('common.pagePrefixed', { page: result.page_number })}`}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 4,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15 }}>{result.title}</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 12 }}>
          {t('common.pagePrefixed', { page: result.page_number })}
        </span>
      </div>
      <div
        style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}
        dangerouslySetInnerHTML={{ __html: result.snippet }}
      />
    </div>
  )
}
