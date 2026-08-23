import { useTranslation } from 'react-i18next'
import { LuCopy, LuExternalLink } from 'react-icons/lu'

/**
 * Entry point to duplicate detection.
 *
 * A link rather than an embedded panel, for the same reasons as
 * {@link FileManagerSection}: reviewing duplicate groups wants the full window,
 * and keeping the delete/merge actions off the settings tab means an accidental
 * click while changing an unrelated setting cannot remove a file.
 *
 * Rendered as a plain anchor rather than a router `Link`, because the settings
 * sections are unit-tested outside a Router and a routing hook here would break
 * every one of those tests for a single navigation.
 */
export default function DuplicatesSection() {
  const { t } = useTranslation()

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.dupes.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.dupes.description')}
      </p>
      <a
        href="/settings/duplicates"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 18px',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 500,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          textDecoration: 'none',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-card-hover)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-card)'
        }}
      >
        <LuCopy size={15} />
        {t('maintenance.dupes.open')}
        <LuExternalLink size={13} style={{ opacity: 0.6 }} />
      </a>
    </div>
  )
}
