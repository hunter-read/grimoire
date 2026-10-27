import { useTranslation } from 'react-i18next'
import { LuDownload, LuFileArchive } from 'react-icons/lu'
import { mediaUrl } from '../../api'

/**
 * Stand-in for the image/PDF/audio pane of a media detail view when the item is
 * an archive (issue #250). Archives are opaque blobs — there is nothing to
 * preview — so the pane offers a download instead of a broken viewer.
 */
export default function ArchivePlaceholder({ fileUrl, filename }) {
  const { t } = useTranslation()

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 40,
        textAlign: 'center',
        background: 'var(--bg-deep)',
      }}
    >
      <LuFileArchive
        size={64}
        color="var(--text-muted)"
        aria-hidden="true"
        style={{ opacity: 0.4 }}
      />
      <p style={{ color: 'var(--text-muted)', maxWidth: 420, margin: 0 }}>
        {t('common.archiveNotViewable')}
      </p>
      <a
        href={mediaUrl(fileUrl)}
        download={filename || ''}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 18px',
          borderRadius: 8,
          background: 'var(--gold)',
          color: 'var(--bg-deep)',
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        <LuDownload size={16} aria-hidden="true" /> {t('common.download')}
      </a>
    </div>
  )
}
