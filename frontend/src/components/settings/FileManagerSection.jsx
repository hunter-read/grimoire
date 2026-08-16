import { useTranslation } from 'react-i18next'
import { LuFolderTree, LuExternalLink } from 'react-icons/lu'

/**
 * Entry point to the library file manager (issue #302).
 *
 * A link rather than an embedded panel: the manager is a two-pane view that
 * wants the full window, and keeping it off the settings tab means an accidental
 * drag while changing an unrelated setting cannot move library files.
 *
 * Rendered as a plain anchor rather than a router `Link`, because the settings
 * sections are unit-tested outside a Router and a routing hook here would break
 * every one of those tests for a single navigation.
 */
export default function FileManagerSection() {
  const { t } = useTranslation()

  return (
    // Sections own the space above the divider that follows them — matching the
    // other maintenance sections, which all carry this same bottom margin.
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{t('files.title')}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('files.sectionDescription')}
      </p>
      <a
        href="/settings/files"
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
        <LuFolderTree size={15} />
        {t('files.open')}
        <LuExternalLink size={13} style={{ opacity: 0.6 }} />
      </a>
    </div>
  )
}
