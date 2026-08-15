import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuCalendar, LuDownload, LuLink } from 'react-icons/lu'
import { campaigns } from '../../api'
import CalendarSubscribeDialog from './CalendarSubscribeDialog'

const MENU_WIDTH = 270

/**
 * The calendar Export/Subscribe button: one trigger opening a menu with the
 * two things a user can do with a schedule — take a static copy, or subscribe
 * to a live feed.
 *
 * Follows WikiExportMenu's shape (a portalled, fixed-position menu that
 * repositions on scroll/resize) so a scrolling card can't clip it.
 *
 * `campaign` scopes it to one campaign; omit it for the global "all my
 * campaigns" variant on the campaigns list, which has no per-campaign download.
 */
export default function CalendarMenu({ campaign, style }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(
      margin,
      Math.min(r.right - MENU_WIDTH, window.innerWidth - margin - MENU_WIDTH)
    )
    const below = window.innerHeight - r.bottom
    const top = below < 160 ? Math.max(margin, r.top - 4 - 160) : r.bottom + 4
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

  const handleDownload = async (e) => {
    e.stopPropagation()
    setOpen(false)
    try {
      await campaigns.downloadCalendar(campaign.id, campaign.name)
    } catch {
      // api.download surfaces its own auth handling; a failed download needs no
      // extra UI here beyond not opening anything.
    }
  }

  const items = [
    campaign && {
      key: 'download',
      Icon: LuDownload,
      label: t('calendar.download'),
      hint: t('calendar.downloadHint'),
      onClick: handleDownload,
    },
    {
      key: 'subscribe',
      Icon: LuLink,
      label: t('calendar.subscribe'),
      hint: campaign ? t('calendar.subscribeHint') : t('calendar.subscribeAllHint'),
      onClick: (e) => {
        e.stopPropagation()
        setOpen(false)
        setShowDialog(true)
      },
    },
  ].filter(Boolean)

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
        title={t('calendar.title')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 12,
          ...style,
          color: open ? 'var(--gold)' : (style?.color ?? 'var(--text-muted)'),
        }}
      >
        <LuCalendar size={13} aria-hidden="true" /> {t('calendar.menu')}
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
            {items.map(({ key, Icon, label, hint, onClick }) => (
              <button
                key={key}
                role="menuitem"
                type="button"
                onClick={onClick}
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
                  {label}
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginTop: 2,
                    }}
                  >
                    {hint}
                  </span>
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}

      {showDialog && (
        <CalendarSubscribeDialog campaign={campaign} onClose={() => setShowDialog(false)} />
      )}
    </>
  )
}
