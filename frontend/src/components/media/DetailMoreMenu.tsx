import { Fragment, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuEllipsisVertical, LuHeart, LuScroll, LuShare2 } from 'react-icons/lu'
import { useUISettings } from '../../context/UISettingsContext'
import { useFavorites } from '../../context/FavoritesContext'
import useAnchoredMenu from '../../hooks/useAnchoredMenu'
import AddToCampaignModal from '../AddToCampaignModal'
import ShareLinkDialog from '../share/ShareLinkDialog'
import useCanShare from '../share/useCanShare'
import type { MediaType } from './mediaConfig'

const MENU_WIDTH = 236

/** A page's own entry in the menu, and the dialog it opens. */
export interface DetailMenuItem {
  key: string
  label: ReactNode
  icon: ReactNode
  /** Hidden from anyone who may not create share links. */
  requiresShare?: boolean
  render: (onClose: () => void) => ReactNode
}

export interface DetailMoreMenuProps {
  resourceType: MediaType
  resourceId: string
  title: string
  extraItems?: DetailMenuItem[]
}

/**
 * The overflow menu (kebab) on a media detail page, the way the book reader has
 * one.
 *
 * Each toolbar keeps what is reached for every visit - back, the version
 * picker, its own editor, Download - and everything else lives here: favourite,
 * add to a campaign, and a share link. A page can add entries of its own with
 * `extraItems` (the map adds its OTFBM setup); each is
 * `{ key, label, icon, requiresShare?, render(onClose) }`, where `render`
 * returns the dialog the entry opens. `requiresShare` hides the entry from
 * anyone who may not create share links.
 *
 * Portalled to document.body at fixed coordinates so the toolbar cannot clip it;
 * its dialogs render outside the panel so they survive it closing.
 */
export default function DetailMoreMenu({
  resourceType,
  resourceId,
  title,
  extraItems = [],
}: DetailMoreMenuProps) {
  const { t } = useTranslation()
  const { hide_campaigns } = useUISettings()
  const favorites = useFavorites()
  const canShare = useCanShare()
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<string | null>(null)
  const { triggerRef, panelRef, style: menuStyle } = useAnchoredMenu(open, { width: MENU_WIDTH })

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      )
        return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, triggerRef, panelRef])

  const isFavorite = favorites?.isFavorite?.(resourceType, resourceId) ?? false
  const close = () => setDialog(null)
  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  const itemStyle: CSSProperties = {
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
        onClick={() => setOpen((o) => !o)}
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
            ref={panelRef}
            role="menu"
            style={{
              ...menuStyle,
              zIndex: 2000,
              padding: '4px 0',
              borderRadius: 8,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 6px 20px var(--shadow)',
              overflowX: 'hidden',
            }}
          >
            <button
              role="menuitem"
              onClick={run(() => favorites?.toggleFavorite?.(resourceType, resourceId))}
              style={{ ...itemStyle, color: isFavorite ? 'var(--gold)' : 'var(--text)' }}
            >
              <LuHeart size={15} aria-hidden="true" fill={isFavorite ? 'var(--gold)' : 'none'} />
              {isFavorite ? t('common.removeFromFavorites') : t('common.addToFavorites')}
            </button>
            {!hide_campaigns && (
              <button role="menuitem" onClick={run(() => setDialog('campaign'))} style={itemStyle}>
                <LuScroll size={15} aria-hidden="true" />
                {t('resources.addToCampaign')}
              </button>
            )}
            {canShare && (
              <button role="menuitem" onClick={run(() => setDialog('share'))} style={itemStyle}>
                <LuShare2 size={15} aria-hidden="true" />
                {t('share.button')}
              </button>
            )}
            {extraItems
              .filter((item) => canShare || !item.requiresShare)
              .map((item) => (
                <button
                  key={item.key}
                  role="menuitem"
                  onClick={run(() => setDialog(item.key))}
                  style={itemStyle}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
          </div>,
          document.body
        )}

      {dialog === 'campaign' && (
        <AddToCampaignModal
          items={[{ resource_type: resourceType, resource_id: resourceId }]}
          onClose={close}
          onAdded={close}
        />
      )}
      {dialog === 'share' && (
        <ShareLinkDialog
          resourceType={resourceType}
          resourceId={resourceId}
          title={title}
          onClose={close}
        />
      )}
      {extraItems.map(
        (item) => dialog === item.key && <Fragment key={item.key}>{item.render(close)}</Fragment>
      )}
    </>
  )
}
