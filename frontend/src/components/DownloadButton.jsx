import { useTranslation } from 'react-i18next'
import { LuDownload } from 'react-icons/lu'
import { mediaUrl } from '../api'

/**
 * Download action for a media item, styled to sit beside the FavoriteButton
 * (heart) on a card. On cards it appears on hover — pass `cardHovered` so it
 * mirrors the heart's visibility. Omit `cardHovered` for the always-visible
 * list/detail variants.
 *
 * @param {string} type one of 'books' | 'maps' | 'tokens' (the API path segment)
 */
export default function DownloadButton({ type, id, style, cardHovered }) {
  const { t } = useTranslation()
  const visible = cardHovered === undefined ? true : cardHovered
  // Overlay (positioned over a thumbnail) vs. static (sits inline in a list row).
  const isStatic = style?.position === 'static'

  return (
    <a
      href={mediaUrl(`/${type}/${id}/file`)}
      download
      onClick={(e) => e.stopPropagation()}
      aria-label={t('common.download')}
      title={t('common.download')}
      style={{
        position: 'absolute',
        top: 6,
        right: 40,
        zIndex: 3,
        width: 28,
        height: 28,
        borderRadius: '50%',
        // Matches FavoriteButton, which it sits beside: a themed disc rather
        // than a fixed dark scrim, so the icon stays legible in a light theme.
        border: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        boxShadow: '0 1px 3px var(--shadow)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'background 0.15s, opacity 0.15s',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        ...style,
      }}
    >
      <LuDownload
        size={isStatic ? 16 : 15}
        color={isStatic ? 'var(--text-muted)' : 'var(--text-dim)'}
        aria-hidden="true"
      />
    </a>
  )
}
