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
 */
export default function MultiSelectDropdown({
  options,
  selected = [],
  onChange,
  label,
  emptyLabel = '—',
  searchPlaceholder,
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

  const toggle = (value) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value]
    onChange(next.length ? next : [])
  }

  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  if (options.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{emptyLabel}</div>
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
        <span>
          {selected.length
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
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
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
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 8px' }}>
                {t('common.noResults')}
              </div>
            ) : (
              filtered.map((o) => (
                <label
                  key={o.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    padding: '5px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: 'var(--text)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={() => toggle(o.value)}
                    aria-label={o.label}
                    style={{ accentColor: 'var(--gold)' }}
                  />
                  {o.label}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
