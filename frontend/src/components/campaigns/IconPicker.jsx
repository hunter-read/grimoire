import { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuBan, LuSearch } from 'react-icons/lu'
import { CAMPAIGN_ICONS, CampaignIcon, searchIconNames } from './campaignIcons'
import { searchEmoji } from './campaignEmoji'
import { resolveIconColor } from './iconColors'
import IconColorRow from './IconColorRow'

const POPOVER_WIDTH = 268
const POPOVER_MAX_HEIGHT = 340
const GRID_MAX_HEIGHT = 168

// Icon picker: a trigger button showing the current icon, opening a searchable
// popover with two tabs — the curated Lucide set and an emoji set — plus a row
// of colour swatches (with a custom hex input) for tinting the chosen icon.
//
// `value` is the stored icon (a Lucide key or an emoji character) and `color`
// the stored tint. `onChange(icon)` and `onColorChange(color)` report each
// independently; `onColorChange` is optional, and the colour row is hidden
// without it. The popover stays open after a pick so the icon and its colour can
// be adjusted together; it closes on Escape, an outside click, or the trigger.
// It is rendered in a portal at fixed viewport coordinates so it isn't clipped
// by a scrolling/overflow-hidden modal body.
export default function IconPicker({
  value,
  onChange,
  color,
  onColorChange,
  fallback,
  ariaLabel,
  compact,
  size,
  triggerColor,
}) {
  const iconSize = size ?? (compact ? 13 : 15)
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('icons')
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const searchId = useId()

  const iconResults = useMemo(() => (tab === 'icons' ? searchIconNames(query) : []), [tab, query])
  const emojiResults = useMemo(() => (tab === 'emoji' ? searchEmoji(query) : []), [tab, query])
  const resolvedTint = resolveIconColor(color)

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    // Prefer below-left; flip/clamp to stay within the viewport.
    let left = r.left
    if (left + POPOVER_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - POPOVER_WIDTH)
    }
    let top = r.bottom + 4
    if (top + POPOVER_MAX_HEIGHT > window.innerHeight - margin) {
      const above = r.top - 4 - POPOVER_MAX_HEIGHT
      top =
        above > margin ? above : Math.max(margin, window.innerHeight - margin - POPOVER_MAX_HEIGHT)
    }
    setCoords({ top, left })
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
    // Capture scroll on any ancestor (e.g. the modal body) so the popover tracks
    // the trigger while scrolling.
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, place])

  // Reset the search when closing so the next open starts from the full set.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  // Picking an icon leaves the popover open so the colour can be set (or the
  // icon swapped) without reopening — Escape or a click outside closes it.
  const pick = (name) => {
    onChange(name)
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel || t('iconPicker.label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={ariaLabel || t('iconPicker.label')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: compact ? 1 : 4,
          padding: compact ? '2px 3px' : '6px 8px',
          background: compact ? 'transparent' : 'var(--bg-deep)',
          border: compact ? '1px solid transparent' : '1px solid var(--border)',
          borderRadius: 6,
          color: resolvedTint || triggerColor || 'var(--text-dim)',
          cursor: 'pointer',
        }}
      >
        {value ? (
          <CampaignIcon name={value} size={iconSize} />
        ) : fallback ? (
          fallback
        ) : (
          <LuBan size={iconSize} aria-hidden="true" />
        )}
        {!compact && <LuChevronDown size={12} aria-hidden="true" />}
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={ariaLabel || t('iconPicker.label')}
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              zIndex: 2000,
              width: POPOVER_WIDTH,
              maxHeight: POPOVER_MAX_HEIGHT,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 8,
              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {/* Tabs */}
            <div role="tablist" style={{ display: 'flex', gap: 2 }}>
              {['icons', 'emoji'].map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  style={tabStyle(tab === key)}
                >
                  {t(`iconPicker.tab_${key}`)}
                </button>
              ))}
            </div>

            {/* Search */}
            <div style={{ position: 'relative' }}>
              <LuSearch
                size={13}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              />
              <input
                id={searchId}
                type="search"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('iconPicker.searchPlaceholder')}
                aria-label={t('iconPicker.searchLabel')}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 8px 6px 26px',
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text)',
                  font: 'inherit',
                  fontSize: 12,
                }}
              />
            </div>

            {/* Results */}
            <div
              style={{
                maxHeight: GRID_MAX_HEIGHT,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: 2,
                alignContent: 'start',
              }}
            >
              {/* "No icon" leads the unfiltered list so clearing stays one click away. */}
              {!query.trim() && (
                <button
                  type="button"
                  onClick={() => pick('')}
                  title={t('iconPicker.none')}
                  aria-label={t('iconPicker.none')}
                  style={iconCell(!value)}
                >
                  <LuBan size={16} aria-hidden="true" />
                </button>
              )}
              {tab === 'icons' &&
                iconResults.map((name) => {
                  const Icon = CAMPAIGN_ICONS[name]
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => pick(name)}
                      title={name}
                      aria-label={name}
                      style={iconCell(value === name)}
                    >
                      <Icon size={16} aria-hidden="true" />
                    </button>
                  )
                })}
              {tab === 'emoji' &&
                emojiResults.map((char) => (
                  <button
                    key={char}
                    type="button"
                    onClick={() => pick(char)}
                    title={char}
                    aria-label={char}
                    style={{ ...iconCell(value === char), fontSize: 16, lineHeight: 1 }}
                  >
                    <span aria-hidden="true">{char}</span>
                  </button>
                ))}
              {((tab === 'icons' && iconResults.length === 0) ||
                (tab === 'emoji' && emojiResults.length === 0)) && (
                <div
                  style={{
                    gridColumn: '1 / -1',
                    padding: '10px 4px',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                  }}
                >
                  {t('iconPicker.noResults')}
                </div>
              )}
            </div>

            {onColorChange && (
              <IconColorRow color={color} resolved={resolvedTint} onColorChange={onColorChange} />
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

const tabStyle = (active) => ({
  flex: 1,
  padding: '5px 8px',
  background: active ? 'var(--bg-card)' : 'transparent',
  border: active ? '1px solid var(--gold-dim, var(--gold))' : '1px solid var(--border)',
  borderRadius: 6,
  color: active ? 'var(--gold)' : 'var(--text-dim)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
})

const iconCell = (active) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  background: active ? 'var(--bg-card)' : 'transparent',
  border: active ? '1px solid var(--gold-dim, var(--gold))' : '1px solid transparent',
  borderRadius: 6,
  color: active ? 'var(--gold)' : 'var(--text-dim)',
  cursor: 'pointer',
})
