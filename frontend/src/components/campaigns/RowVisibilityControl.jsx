import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuCheck } from 'react-icons/lu'
import { VIS_META, POPOVER_WIDTH } from './wikiShared'

// The per-row visibility indicator in the campaign tree.
//
// Visibility is carried by a distinct glyph rather than by tinting the entry's
// icon, so it stays readable for colourblind users and frees the icon colour to
// be a user choice. Restricted pages (gm / members) always show their glyph;
// fully-visible (group) pages show theirs only on row hover or keyboard focus,
// keeping the default state uncluttered.
//
// When the viewer can edit the page the glyph is a button opening the same
// level menu as the header's VisibilityEditor; otherwise it renders as a plain
// glyph with a tooltip.
export default function RowVisibilityControl({
  visibility,
  canEdit,
  isOwner,
  rowHovered,
  onSetVisibility,
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  const meta = VIS_META[visibility] || VIS_META.gm
  const { Icon } = meta
  const isRestricted = visibility !== 'group'
  // Restricted pages always advertise their state; "group" is the unremarkable
  // default, so it only surfaces on interaction.
  const visible = isRestricted || rowHovered || focused || open
  const options = isOwner ? ['gm', 'group', 'members'] : ['group']

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    let left = r.right - POPOVER_WIDTH
    if (left < margin) left = margin
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
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
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

  const label = t('wiki.visibilityIs', { level: t(`wiki.vis_${meta.key}`) })

  // Read-only viewers get the glyph without the menu affordance.
  if (!canEdit) {
    return (
      <span
        title={label}
        aria-label={label}
        role="img"
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          color: 'var(--text-muted)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 120ms ease',
        }}
      >
        <Icon size={12} aria-hidden="true" />
      </span>
    )
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
        onMouseDown={(e) => e.stopPropagation()}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        draggable={false}
        onDragStart={(e) => e.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('wiki.changeVisibilityFrom', { level: t(`wiki.vis_${meta.key}`) })}
        title={label}
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--text-muted)',
          // Kept in the layout at all times so rows don't shift on hover.
          opacity: visible ? 1 : 0,
          transition: 'opacity 120ms ease',
        }}
      >
        <Icon size={12} aria-hidden="true" />
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
              const selected = visibility === v
              // Restore to the item's own resting background, so leaving the
              // selected row doesn't strip the highlight marking it as current.
              const restingBg = selected ? 'var(--bg-card)' : 'transparent'
              return (
                <button
                  key={v}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!selected) onSetVisibility(v)
                    setOpen(false)
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
                  <OptIcon size={13} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{t(`wiki.vis_${m.key}`)}</span>
                  {selected && <LuCheck size={13} style={{ color: 'var(--gold)' }} />}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}
