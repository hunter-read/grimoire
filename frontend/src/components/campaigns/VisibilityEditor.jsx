import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuCheck } from 'react-icons/lu'
import { VIS_META, badgeStyle, POPOVER_WIDTH } from './wikiShared'

// Editable visibility badge: a pill that opens a popover for changing the page's
// visibility level. For "members" (Private), the popover lists campaign members
// with per-member access toggles so the owner can grant/revoke without opening
// the full editor. The popover is portalled at fixed coordinates so it isn't
// clipped by surrounding overflow.
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
  // Match PageEditor's option gating: only the campaign owner may use the GM-only
  // and Private (specific members) levels; everyone else is limited to Public.
  const options = isOwner ? ['gm', 'group', 'members'] : ['group']
  const members = (campaign.members || []).filter((m) => !m.is_owner)
  const sharedIds = page.shared_user_ids || []

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    let left = r.left
    if (left + POPOVER_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - POPOVER_WIDTH)
    }
    setCoords({ top: r.bottom + 4, left })
  }, [])

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

  const toggleMember = (userId) => {
    const next = sharedIds.includes(userId)
      ? sharedIds.filter((id) => id !== userId)
      : [...sharedIds, userId]
    onSetShares(next)
  }

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
        <Icon size={11} /> {t(`wiki.vis_${meta.key}`)}
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
              width: POPOVER_WIDTH,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 6,
              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
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
                  <span style={{ flex: 1 }}>{t(`wiki.vis_${m.key}`)}</span>
                  {selected && <LuCheck size={13} style={{ color: 'var(--gold)' }} />}
                </button>
              )
            })}

            {isOwner && page.visibility === 'members' && (
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
                {members.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 4px' }}>
                    {t('wiki.noMembers')}
                  </div>
                ) : (
                  members.map((mb) => {
                    const checked = sharedIds.includes(mb.user_id)
                    const name = mb.character_name || mb.display_name || mb.username
                    return (
                      <button
                        key={mb.user_id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={checked}
                        onClick={() => toggleMember(mb.user_id)}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = 'var(--bg-card-hover)')
                        }
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        onFocus={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                        onBlur={(e) => (e.currentTarget.style.background = 'transparent')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          padding: '5px 8px',
                          background: 'transparent',
                          border: '1px solid transparent',
                          borderRadius: 6,
                          color: checked ? 'var(--text)' : 'var(--text-dim)',
                          cursor: 'pointer',
                          font: 'inherit',
                          fontSize: 13,
                          textAlign: 'left',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            flexShrink: 0,
                            width: 15,
                            height: 15,
                            borderRadius: 4,
                            border: `1px solid ${checked ? 'var(--gold)' : 'var(--border)'}`,
                            background: checked ? 'var(--gold)' : 'transparent',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {checked && <LuCheck size={11} color="#1a1209" />}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {name}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </span>
  )
}
