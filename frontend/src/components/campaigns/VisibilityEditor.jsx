import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuCheck } from 'react-icons/lu'
import {
  VIS_META,
  badgeStyle,
  POPOVER_WIDTH,
  SHARE_POPOVER_WIDTH,
  VIS_OPTIONS,
  visLabelKey,
} from './wikiShared'
import ShareAccessTable from './ShareAccessTable'

// Editable visibility badge: a pill that opens a popover for changing the page's
// visibility level. For "members" (Private), the popover lists campaign members
// with a three-way access control — no access / can read / can edit — so the
// author can grant or revoke either level without opening the full editor. The
// popover is portalled at fixed coordinates so it isn't clipped by surrounding
// overflow.
//
// Only rendered for the page's author: classifying a page is the author's right
// even where editing its text is everyone's.
export default function VisibilityEditor({
  campaign,
  isOwner,
  page,
  onSetVisibility,
  onSetShares,
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  const meta = VIS_META[page.visibility] || VIS_META.gm
  const { Icon } = meta
  // Every level is open to whoever wrote the page; what "author only" is called
  // depends on whether that author is the GM.
  const options = VIS_OPTIONS
  // The share list covers everyone in the campaign except the author. For a
  // player's private page that includes the GM, who is otherwise excluded by
  // `is_owner` — a player sharing with their GM is the ordinary case (#232).
  const members = (campaign.members || []).filter((m) => m.user_id !== page.created_by_id)
  const sharedIds = page.shared_user_ids || []
  const writeIds = page.shared_write_user_ids || []
  // Only the Private level shows the share table, so the popover widens for it
  // and stays narrow when it is just the three levels.
  const width = page.visibility === 'members' ? SHARE_POPOVER_WIDTH : POPOVER_WIDTH

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    let left = r.left
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - width)
    }
    setCoords({ top: r.bottom + 4, left })
  }, [width])

  useEffect(() => {
    if (!open) return
    place()
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || popoverRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onReposition = () => place()
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, place])

  return (
    <span style={{ display: 'inline-flex' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('wiki.changeVisibility')}
        title={t('wiki.changeVisibility')}
        style={badgeStyle(meta, true)}
      >
        <Icon size={11} /> {t(visLabelKey(meta.key, isOwner))}
        <LuChevronDown size={11} aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              zIndex: 2000,
              width,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 6,
              boxShadow: '0 6px 20px var(--shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {options.map((v) => {
              const m = VIS_META[v]
              const OptIcon = m.Icon
              const selected = page.visibility === v
              // Restore to the item's own resting background, so leaving the
              // selected row doesn't strip the highlight marking it as current.
              const restingBg = selected ? 'var(--bg-card)' : 'transparent'
              return (
                <button
                  key={v}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    if (!selected) onSetVisibility(v)
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = restingBg)}
                  onFocus={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                  onBlur={(e) => (e.currentTarget.style.background = restingBg)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    background: restingBg,
                    border: '1px solid transparent',
                    borderRadius: 6,
                    color: selected ? 'var(--text)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    font: 'inherit',
                    fontSize: 13,
                    textAlign: 'left',
                  }}
                >
                  <OptIcon size={13} style={{ color: m.color, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{t(visLabelKey(m.key, isOwner))}</span>
                  {selected && <LuCheck size={13} style={{ color: 'var(--gold)' }} />}
                </button>
              )
            })}

            {page.visibility === 'members' && (
              <div
                style={{
                  borderTop: '1px solid var(--border)',
                  marginTop: 4,
                  paddingTop: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    padding: '0 4px 4px',
                  }}
                >
                  {t('wiki.shareWith')}
                </div>
                <div style={{ padding: '0 4px' }}>
                  <ShareAccessTable
                    members={members}
                    readIds={sharedIds}
                    writeIds={writeIds}
                    onChange={onSetShares}
                  />
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
    </span>
  )
}
