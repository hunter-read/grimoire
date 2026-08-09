import { useTranslation } from 'react-i18next'
import useLinkProps from '../../hooks/useLinkProps'

/**
 * One full-text page hit in the in-system search results. Behaves like a link:
 * a plain click opens the reader at that page, middle click and ctrl/cmd-click
 * open it in a new tab (issue #313).
 */
export default function SystemPageHit({ result, onOpen }) {
  const { t } = useTranslation()
  const linkProps = useLinkProps(`/library/book/${result.id}?page=${result.page_number}`, onOpen)
  return (
    <div
      {...linkProps}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        marginBottom: 8,
        cursor: 'pointer',
      }}
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
