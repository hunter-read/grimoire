import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuCheck } from 'react-icons/lu'
import { VIS_META, POPOVER_WIDTH, VIS_OPTIONS, visLabelKey } from './wikiShared'
import useAnchoredMenu from '../../hooks/useAnchoredMenu'

// The per-row visibility indicator in the campaign tree.
//
// Visibility is carried by a distinct glyph rather than by tinting the entry's
// icon, so it stays readable for colourblind users and frees the icon colour to
// be a user choice. Restricted pages (gm / members) always show their glyph;
// fully-visible (group) pages show theirs only on row hover or keyboard focus,
// keeping the default state uncluttered.
//
// Only the page's *author* may reclassify it, which is narrower than who may
// edit its text: on a public page everyone can contribute, but nobody else gets
// to take it private. So the glyph opens the level menu for the author and
// renders as a plain tooltip'd glyph for everyone else.
export default function RowVisibilityControl({
  visibility,
  isMine,
  authorIsGm = true,
  rowHovered,
  onSetVisibility,
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const {
    triggerRef,
    panelRef: popoverRef,
    style: popoverStyle,
  } = useAnchoredMenu(open, { width: POPOVER_WIDTH })

  const meta = VIS_META[visibility] || VIS_META.gm
  const { Icon } = meta
  const isRestricted = visibility !== 'group'
  // Restricted pages always advertise their state; "group" is the unremarkable
  // default, so it only surfaces on interaction.
  const visible = isRestricted || rowHovered || focused || open
  const options = VIS_OPTIONS

  useEffect(() => {
    if (!open) return
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
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, triggerRef, popoverRef])

  const label = t('wiki.visibilityIs', { level: t(visLabelKey(meta.key, authorIsGm)) })

  // Anyone but the author gets the glyph without the menu affordance.
  if (!isMine) {
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
        aria-label={t('wiki.changeVisibilityFrom', {
          level: t(visLabelKey(meta.key, authorIsGm)),
        })}
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
              ...popoverStyle,
              zIndex: 2000,
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
                  <span style={{ flex: 1 }}>{t(visLabelKey(m.key, authorIsGm))}</span>
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
