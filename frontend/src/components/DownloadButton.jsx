import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDownload } from 'react-icons/lu'
import { mediaUrl } from '../api'
import useVariantOptions from './useVariantOptions'

const MENU_WIDTH = 200

/**
 * Download action for a media item, styled to sit beside the FavoriteButton
 * (heart) on a card. On cards it appears on hover — pass `cardHovered` so it
 * mirrors the heart's visibility. Omit `cardHovered` for the always-visible
 * list/detail variants.
 *
 * When the item has other versions (`variant_count > 0`, or an inline
 * `variants` array on a detail payload) the button opens a picker so the user
 * can choose which file to download — a bulk folder download ships every
 * version, but a single download has to ask which one (issues #304, #306).
 * With one version it stays exactly what it was: a plain `<a download>`, so the
 * common case costs no request and no extra click.
 *
 * @param {string} type one of 'books' | 'maps' | 'tokens' | 'audio' (the API path segment)
 * @param {object} [item] the list row or detail payload, for the version count
 */
export default function DownloadButton({ type, id, style, cardHovered, item }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const { options, loading, load, label } = useVariantOptions(type, id, item)

  const visible = cardHovered === undefined ? true : cardHovered
  // Overlay (positioned over a thumbnail) vs. static (sits inline in a list row).
  const isStatic = style?.position === 'static'

  // A list row knows only the count; a detail payload carries the family.
  const hasVersions = item
    ? (item.variant_count || 0) > 0 || (item.variants || []).length > 0
    : false

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const anchorStyle = {
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
  }

  const icon = (
    <LuDownload
      size={isStatic ? 16 : 15}
      color={isStatic ? 'var(--text-muted)' : 'var(--text-dim)'}
      aria-hidden="true"
    />
  )

  if (!hasVersions) {
    return (
      <a
        href={mediaUrl(`/${type}/${id}/file`)}
        download
        onClick={(e) => e.stopPropagation()}
        aria-label={t('common.download')}
        title={t('common.download')}
        style={anchorStyle}
      >
        {icon}
      </a>
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'static', display: 'contents' }}>
      <button
        type="button"
        aria-label={t('variants.downloadVersion')}
        title={t('variants.downloadVersion')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          load()
          setOpen((v) => !v)
        }}
        style={anchorStyle}
      >
        {icon}
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            // Hangs below the button, right-aligned with it so it stays on the
            // card rather than overflowing a grid column.
            top: (style?.top ?? 6) + 32,
            right: style?.right ?? 40,
            zIndex: 2000,
            width: MENU_WIDTH,
            padding: '4px 0',
            borderRadius: 8,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            boxShadow: '0 6px 20px var(--shadow)',
            textAlign: 'left',
          }}
        >
          {loading ? (
            <div style={{ padding: '6px 12px', fontSize: 13, color: 'var(--text-muted)' }}>
              {t('common.loading')}
            </div>
          ) : (
            options.map((option) => (
              <a
                key={option.id}
                role="menuitem"
                href={mediaUrl(`/${type}/${option.id}/file`)}
                download
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                }}
                style={{
                  display: 'block',
                  padding: '6px 12px',
                  fontSize: 13,
                  color: 'var(--text)',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {label(option)}
              </a>
            ))
          )}
        </div>
      )}
    </div>
  )
}
