import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuDownload } from 'react-icons/lu'
import { mediaUrl } from '../api'
import useVariantOptions from './useVariantOptions'

/**
 * The detail page's Download button, with a version picker when there is more
 * than one file.
 *
 * The three media detail views (map, token, audio) each had a byte-identical
 * download anchor; this is that anchor, plus the dropdown. With a single
 * version it renders exactly the old markup — a plain `<a download>` — so the
 * ordinary case is unchanged.
 *
 * The detail payload already carries the whole family, so unlike the card
 * button this never needs a request.
 *
 * @param {string} type API path segment: 'maps' | 'tokens' | 'audio' | 'books'
 * @param {object} item the detail payload (carries `variants`)
 * @param {boolean} compact hide the text label, leaving the icon (mobile)
 */
export default function DownloadVersionButton({ type, id, item, compact }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const { options, label, filename } = useVariantOptions(type, id, item)

  const hasVersions = (item?.variants || []).length > 0

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

  const baseStyle = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    color: 'var(--text-dim)',
    borderRadius: 4,
    padding: '4px 12px',
    fontSize: 14,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    textDecoration: 'none',
    cursor: 'pointer',
  }

  if (!hasVersions) {
    return (
      <a href={mediaUrl(`/${type}/${id}/file`)} download style={baseStyle}>
        <LuDownload size={13} /> {!compact && t('common.download')}
      </a>
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={baseStyle}
      >
        <LuDownload size={13} /> {!compact && t('common.download')}
        <LuChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            zIndex: 2000,
            minWidth: 200,
            maxWidth: 360,
            padding: '4px 0',
            borderRadius: 8,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            boxShadow: '0 6px 20px var(--shadow)',
          }}
        >
          {options.map((option) => (
            <a
              key={option.id}
              role="menuitem"
              href={mediaUrl(`/${type}/${option.id}/file`)}
              download
              onClick={() => setOpen(false)}
              style={{
                display: 'block',
                padding: '6px 12px',
                fontSize: 13,
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              {label(option)}
              {filename(option) && (
                <span
                  style={{
                    display: 'block',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginTop: 1,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {filename(option)}
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
