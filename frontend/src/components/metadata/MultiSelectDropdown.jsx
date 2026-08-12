import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuSearch, LuX } from 'react-icons/lu'

/**
 * A searchable multi-select dropdown. Shows a trigger with the count of
 * selected values; opening reveals a search box and a scrollable checkbox list.
 * Scales cleanly to long option lists (e.g. 50+ tags) unlike an inline pill row.
 *
 * Props:
 *  - options: [{ value, label }]
 *  - selected: string[]
 *  - onChange: (nextSelected) => void
 *  - label: trigger/aria label
 *  - emptyLabel: shown when there are no options at all
 *  - searchPlaceholder
 *  - specialOptions: [{ value, label }] pinned above the regular options and
 *    exempt from the search box — used for presence filters ("has no genre").
 */
export default function MultiSelectDropdown({
  options,
  selected = [],
  onChange,
  label,
  emptyLabel = '—',
  searchPlaceholder,
  specialOptions = [],
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // A presence filter ("no tags" / "any tags") is exclusive: it can't be
  // combined with a concrete value, or with the other sentinel. Picking one
  // replaces the selection outright, and picking a concrete value drops it.
  const specialValues = new Set(specialOptions.map((o) => o.value))
  const activeSpecial = selected.find((v) => specialValues.has(v))

  const toggle = (value) => {
    const isSpecial = specialValues.has(value)
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
      return
    }
    onChange(isSpecial ? [value] : [...selected.filter((v) => !specialValues.has(v)), value])
  }

  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  // With no concrete options and no special entries there is nothing to pick.
  if (options.length === 0 && specialOptions.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{emptyLabel}</div>
  }

  const renderOption = (o) => {
    const checked = selected.includes(o.value)
    // While a presence filter is active the concrete values are unselectable —
    // shown disabled rather than silently ignoring the click. The sentinels
    // stay live so you can switch straight from one to the other.
    const disabled = Boolean(activeSpecial) && !checked && !specialValues.has(o.value)
    return (
      <label
        key={o.value}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          padding: '5px 8px',
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: 'var(--text)',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={() => toggle(o.value)}
          aria-label={o.label}
          style={{ accentColor: 'var(--gold)' }}
        />
        {o.label}
      </label>
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 13,
          padding: '6px 10px',
          borderRadius: 6,
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          color: selected.length ? 'var(--gold)' : 'var(--text-dim)',
          cursor: 'pointer',
        }}
      >
        {/* A presence filter is always the whole selection, so name it rather
            than reporting a meaningless "1 selected". */}
        <span>
          {activeSpecial
            ? specialOptions.find((o) => o.value === activeSpecial).label
            : selected.length
              ? t('sortFilter.multiSelected', { count: selected.length })
              : t('sortFilter.multiAny')}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {selected.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('sortFilter.clear')}
              onClick={(e) => {
                e.stopPropagation()
                onChange([])
              }}
              style={{ display: 'inline-flex', color: 'var(--text-muted)' }}
            >
              <LuX size={13} />
            </span>
          )}
          <LuChevronDown size={14} />
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '110%',
            zIndex: 30,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 6px 20px var(--shadow)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{ position: 'relative', padding: 6, borderBottom: '1px solid var(--border)' }}
          >
            <LuSearch
              size={13}
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder || t('common.search')}
              aria-label={searchPlaceholder || t('common.search')}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontSize: 13,
                padding: '6px 8px 6px 28px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-input)',
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', padding: 4 }}>
            {/* Special entries are pinned above the list and stay visible while
                searching — they aren't values you'd search for by name. */}
            {specialOptions.length > 0 && (
              <div
                style={{
                  borderBottom: '1px solid var(--border)',
                  paddingBottom: 4,
                  marginBottom: 4,
                }}
              >
                {specialOptions.map(renderOption)}
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 8px' }}>
                {t('common.noResults')}
              </div>
            ) : (
              filtered.map(renderOption)
            )}
          </div>
        </div>
      )}
    </div>
  )
}
