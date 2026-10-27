import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuEllipsisVertical, LuSettings, LuUsers, LuArchive } from 'react-icons/lu'
import useAnchoredMenu from '../../hooks/useAnchoredMenu'

const MENU_WIDTH = 240

/**
 * Consolidated campaign management actions (kebab): Edit, Convert to group, and
 * Archive/Unarchive. Follows BookActionsMenu's shape — a portalled, fixed-position
 * menu that repositions on scroll/resize so it can't be clipped by an ancestor,
 * and that `useAnchoredMenu` keeps inside the viewport when the trigger sits low
 * on the page.
 *
 * Deliberately excluded:
 *  - **Open notes** stays a standalone primary button; it's the main thing you
 *    come to this page to do, not a management action.
 *  - **Leave campaign** stays visible too. It applies to members rather than
 *    owners, so it never appears alongside these items anyway, and burying an
 *    exit behind a menu makes it harder to find than it should be.
 *  - **Delete** stays in the edit modal. Reaching it through Edit costs one more
 *    click and states the intent, which is the point for a destructive action.
 *
 * Each item is optional: pass only the handlers the current user is entitled to
 * and the menu renders just those. It returns null when nothing is available,
 * so the caller doesn't need to guard it.
 */
export default function CampaignActionsMenu({ onEdit, onConvert, onArchive, isArchived }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const {
    triggerRef,
    panelRef: menuRef,
    style: menuStyle,
  } = useAnchoredMenu(open, { width: MENU_WIDTH })

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, triggerRef, menuRef])

  // Nothing this user can do — render no trigger at all rather than an empty menu.
  if (!onEdit && !onConvert && !onArchive) return null

  const run = (fn) => (e) => {
    e.stopPropagation()
    setOpen(false)
    fn()
  }

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

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-label={t('campaignDetail.actionsMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('campaignDetail.actionsMenu')}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '7px 10px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          color: open ? 'var(--gold)' : 'var(--text-dim)',
          cursor: 'pointer',
          fontSize: 13,
        }}
      >
        <LuEllipsisVertical size={16} aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              ...menuStyle,
              zIndex: 2000,
              padding: '4px 0',
              borderRadius: 8,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 6px 20px var(--shadow)',
              // Clips the square-cornered first/last items to the panel's
              // radius. Horizontal only: `overflow: hidden` would override the
              // vertical scrolling the hook sets on an over-tall menu.
              overflowX: 'hidden',
            }}
          >
            {onEdit && (
              <button role="menuitem" onClick={run(onEdit)} style={itemStyle}>
                <LuSettings size={15} aria-hidden="true" />
                {t('campaignDetail.edit')}
              </button>
            )}
            {onConvert && (
              <button
                role="menuitem"
                onClick={run(onConvert)}
                title={t('campaignDetail.convertHint')}
                style={itemStyle}
              >
                <LuUsers size={15} aria-hidden="true" />
                {t('campaignDetail.convertToGroup')}
              </button>
            )}
            {onArchive && (
              <button role="menuitem" onClick={run(onArchive)} style={itemStyle}>
                <LuArchive size={15} aria-hidden="true" />
                {isArchived ? t('campaignDetail.unarchive') : t('campaignDetail.archive')}
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
