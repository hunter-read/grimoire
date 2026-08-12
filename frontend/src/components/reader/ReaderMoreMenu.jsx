import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  LuEllipsisVertical,
  LuScroll,
  LuInfo,
  LuHeart,
  LuFileText,
  LuColumns2,
  LuFile,
  LuBookCopy,
  LuDownload,
  LuKeyboard,
  LuCheck,
} from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { useUISettings } from '../../context/UISettingsContext'
import AddToCampaignModal from '../AddToCampaignModal'

const MENU_WIDTH = 236

export const MODE_ITEMS = [
  { key: 'page', Icon: LuFileText },
  { key: 'spread', Icon: LuColumns2 },
  { key: 'pdf', Icon: LuFile },
]

/**
 * The reader's overflow menu (kebab), holding everything that isn't reached on
 * every page turn: add to campaign, view details, favorite, the page/spread/PDF
 * mode switch, download, and the keyboard-shortcut overlay.
 *
 * Splitting these out of the toolbar leaves it with only the controls used while
 * actually reading — navigation, zoom, and the sidebar panels — so the page
 * position stays centred rather than being pushed around by a row of actions.
 *
 * The menu is portalled to document.body at fixed coordinates so it isn't
 * clipped by the toolbar, mirroring BookActionsMenu in the library views.
 */
export default function ReaderMoreMenu({
  bookId,
  mode,
  onModeChange,
  spreadOffset,
  onSpreadOffsetChange,
  isMobilePhone,
  isFavorite,
  onToggleFavorite,
  onShowDetails,
  onToggleShortcuts,
}) {
  const { t } = useTranslation()
  const { hide_campaigns } = useUISettings()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const [addToCampaign, setAddToCampaign] = useState(false)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    let left = r.right - MENU_WIDTH
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - MENU_WIDTH))
    setCoords({ top: r.bottom + 4, left })
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onReposition = () => place()
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
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

  const itemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '9px 12px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    color: 'var(--text)',
    textAlign: 'left',
  }

  const dividerStyle = { height: 1, background: 'var(--border)', margin: '4px 0' }

  const run = (fn) => (e) => {
    e.stopPropagation()
    setOpen(false)
    fn()
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-label={t('bookActions.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('bookActions.menu')}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          padding: '5px 8px',
          color: open ? 'var(--gold)' : 'var(--text-dim)',
        }}
      >
        <LuEllipsisVertical size={15} aria-hidden="true" />
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
            {!hide_campaigns && (
              <button role="menuitem" onClick={run(() => setAddToCampaign(true))} style={itemStyle}>
                <LuScroll size={15} aria-hidden="true" />
                {t('resources.addToCampaign')}
              </button>
            )}

            <button role="menuitem" onClick={run(onShowDetails)} style={itemStyle}>
              <LuInfo size={15} aria-hidden="true" />
              {t('bookActions.details')}
            </button>

            <button
              role="menuitem"
              onClick={run(onToggleFavorite)}
              style={{ ...itemStyle, color: isFavorite ? 'var(--gold)' : 'var(--text)' }}
            >
              <LuHeart
                size={15}
                aria-hidden="true"
                fill={isFavorite ? 'var(--gold)' : 'none'}
                style={{ flexShrink: 0 }}
              />
              {isFavorite ? t('reader.removeFromFavorites') : t('reader.addToFavorites')}
            </button>

            {/* Mode switch — hidden on phones, where the reader is locked to
                single-page and the choice would do nothing. */}
            {!isMobilePhone && (
              <>
                <div style={dividerStyle} />
                {MODE_ITEMS.map(({ key, Icon }) => (
                  <Fragment key={key}>
                    <button
                      role="menuitemradio"
                      aria-checked={mode === key}
                      onClick={run(() => onModeChange(key))}
                      style={{ ...itemStyle, color: mode === key ? 'var(--gold)' : 'var(--text)' }}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span style={{ flex: 1 }}>{t(`reader.${key}`)}</span>
                      {mode === key && <LuCheck size={14} aria-hidden="true" />}
                    </button>

                    {/* Cover pairing — a sub-option of spread, so it is indented
                        directly beneath it and only while spread is selected.
                        Unlike the other items this leaves the menu open: it is
                        the one choice you want to flip and see the result of. */}
                    {key === 'spread' && mode === 'spread' && (
                      <button
                        role="menuitemcheckbox"
                        aria-checked={spreadOffset === 1}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSpreadOffsetChange(spreadOffset === 0 ? 1 : 0)
                        }}
                        style={{
                          ...itemStyle,
                          paddingLeft: 34,
                          fontSize: 12,
                          color: spreadOffset === 1 ? 'var(--gold)' : 'var(--text-dim)',
                        }}
                      >
                        <LuBookCopy size={14} aria-hidden="true" />
                        <span style={{ flex: 1 }}>{t('reader.spreadPairCover')}</span>
                        {spreadOffset === 1 && <LuCheck size={13} aria-hidden="true" />}
                      </button>
                    )}
                  </Fragment>
                ))}
                <div style={dividerStyle} />
              </>
            )}

            <a
              role="menuitem"
              href={mediaUrl(`/books/${bookId}/file`)}
              download
              onClick={() => setOpen(false)}
              style={{ ...itemStyle, textDecoration: 'none' }}
            >
              <LuDownload size={15} aria-hidden="true" />
              {t('reader.downloadFile')}
            </a>

            <button role="menuitem" onClick={run(onToggleShortcuts)} style={itemStyle}>
              <LuKeyboard size={15} aria-hidden="true" />
              {t('reader.keyboardShortcuts')}
            </button>
          </div>,
          document.body
        )}

      {/* Rendered outside the menu so it survives the menu closing on click. */}
      {addToCampaign && (
        <AddToCampaignModal
          items={[{ resource_type: 'book', resource_id: bookId }]}
          onClose={() => setAddToCampaign(false)}
          onAdded={() => setAddToCampaign(false)}
        />
      )}
    </>
  )
}
