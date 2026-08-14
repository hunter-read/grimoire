import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuDownload, LuFileArchive, LuFileText, LuBraces } from 'react-icons/lu'

const MENU_WIDTH = 260

// The formats the wiki export endpoint accepts, in the order they're offered:
// the zip first (the round-trippable Obsidian-friendly one), then the single
// combined file, then the JSON bundle.
const FORMATS = [
  { format: 'md', Icon: LuFileArchive, labelKey: 'wiki.exportMd', hintKey: 'wiki.exportMdHint' },
  {
    format: 'mdfile',
    Icon: LuFileText,
    labelKey: 'wiki.exportMdFile',
    hintKey: 'wiki.exportMdFileHint',
  },
  { format: 'json', Icon: LuBraces, labelKey: 'wiki.exportJson', hintKey: 'wiki.exportJsonHint' },
]

/**
 * The wiki's single Export button: one standard-styled trigger opening a menu of
 * download formats (issue #289), replacing the row of dashed per-format buttons.
 *
 * Follows CampaignActionsMenu's shape — a portalled, fixed-position menu that
 * repositions on scroll/resize, so the sidebar's own scroll container can't clip
 * it. `onExport(format)` receives the chosen format string.
 */
export default function WikiExportMenu({ onExport, style }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - margin - MENU_WIDTH))
    // The button sits at the foot of the sidebar, so the menu opens upward when
    // there isn't room below it.
    const below = window.innerHeight - r.bottom
    const top = below < 200 ? Math.max(margin, r.top - 4 - 200) : r.bottom + 4
    setCoords({ top, left })
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    const onReposition = () => place()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, place])

  const choose = (format) => (e) => {
    e.stopPropagation()
    setOpen(false)
    onExport(format)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('wiki.exportTitle')}
        style={{ ...style, color: open ? 'var(--gold)' : style?.color }}
      >
        <LuDownload size={13} aria-hidden="true" /> {t('wiki.export')}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              zIndex: 2000,
              width: MENU_WIDTH,
              padding: '4px 0',
              borderRadius: 8,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 6px 20px var(--shadow)',
              overflow: 'hidden',
            }}
          >
            {FORMATS.map(({ format, Icon, labelKey, hintKey }) => (
              <button
                key={format}
                role="menuitem"
                type="button"
                onClick={choose(format)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  width: '100%',
                  padding: '9px 12px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--text)',
                  textAlign: 'left',
                }}
              >
                <Icon size={15} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                <span>
                  {t(labelKey)}
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginTop: 2,
                    }}
                  >
                    {t(hintKey)}
                  </span>
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
