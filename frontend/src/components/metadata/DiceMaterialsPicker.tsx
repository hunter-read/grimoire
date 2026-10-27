import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import api from '../../api'
import { buildDiceMaterialRows } from './diceMaterials'

/**
 * Combobox multi-select for a system's dice / materials, modeled on GenrePicker.
 * Selected values show as removable chips. Typing filters a curated, grouped
 * list; group headers are shown but not selectable. Text that matches no option
 * offers a "Create «text»" row for a custom value.
 *
 * The option groups come from the managed dice/materials lookup when a `groups`
 * prop is supplied (built via `groupsFromManaged`), otherwise the built-in
 * defaults are used. Creating a custom value best-effort persists it to the
 * managed list (admin only) and calls `onCreate` to refresh, mirroring
 * GenrePicker; without `onCreate` it simply adds the free-text value.
 */
export default function DiceMaterialsPicker({ selected, onChange, groups, onCreate }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef(null)

  const has = (name) => selected.some((g) => g.toLowerCase() === name.toLowerCase())

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const q = query.trim().toLowerCase()
  // Grouped rows, dropping already-selected items and (when filtering) any group
  // that ends up with no matching items. `groups` (when supplied) sources the
  // options from the managed dice/materials lookup; otherwise built-in defaults.
  const allRows = groups
    ? buildDiceMaterialRows(selected, t('metadata.diceCustomGroup'), groups)
    : buildDiceMaterialRows(selected, t('metadata.diceCustomGroup'))
  const grouped = []
  for (const row of allRows) {
    if (row.type === 'group') {
      grouped.push({ header: row, items: [] })
    } else if (!has(row.value) && (!q || row.value.toLowerCase().includes(q))) {
      grouped[grouped.length - 1]?.items.push(row)
    }
  }
  const visibleGroups = grouped.filter((g) => g.items.length > 0)

  const exact = allRows.some((r) => r.type === 'item' && r.value.toLowerCase() === q)
  const canCreate = q.length > 0 && !exact

  // Flat list of selectable option rows (for keyboard nav), plus an optional
  // create row. Group headers are rendered but excluded from this list.
  const optionRows = [
    ...visibleGroups.flatMap((g) => g.items),
    ...(canCreate ? [{ type: 'create', value: query.trim() }] : []),
  ]

  const add = (value) => {
    const v = value.trim()
    if (v && !has(v)) onChange([...selected, v])
  }

  // Best-effort: persist a newly created value to the managed lookup so it shows
  // up in the list later. Ignored if not permitted (non-admin) or already exists.
  const persistCustom = (value) => {
    const v = value.trim()
    if (!v) return
    const known = allRows.some(
      (r) => r.type === 'item' && r.value.toLowerCase() === v.toLowerCase()
    )
    if (known) return
    api
      .post('/dice-materials', { name: v, group: 'Custom' })
      .then((created) => onCreate && onCreate(created))
      .catch(() => {})
  }

  const choose = (row) => {
    if (!row) return
    if (row.type === 'create' && onCreate) persistCustom(row.value)
    add(row.value)
    setQuery('')
    setActiveIdx(0)
    setOpen(true)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIdx((i) => Math.min(i + 1, optionRows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(optionRows[activeIdx] || optionRows[0])
    } else if (e.key === 'Backspace' && !query && selected.length > 0) {
      onChange(selected.slice(0, -1))
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Global index into optionRows (for highlight), tracked as we render.
  let optIdx = -1

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
        {selected.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('metadata.noDiceMaterials')}
          </span>
        )}
        {selected.map((g) => (
          <span
            key={g}
            style={{
              fontSize: 12,
              padding: '2px 6px 2px 8px',
              borderRadius: 10,
              background: 'rgba(214, 178, 74, 0.10)',
              border: '1px solid var(--gold)',
              color: 'var(--gold)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {g}
            <button
              type="button"
              onClick={() => onChange(selected.filter((x) => x !== g))}
              aria-label={`Remove ${g}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'inherit',
                padding: '0 0 0 4px',
                lineHeight: 1,
              }}
            >
              <LuX size={10} />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={t('metadata.addDiceMaterial')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActiveIdx(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t('metadata.diceMaterialsComboPlaceholder')}
        style={{ width: '100%' }}
      />
      {open && optionRows.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            zIndex: 30,
            marginTop: 2,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 6px 20px var(--shadow)',
          }}
        >
          {visibleGroups.map((g) => (
            <div key={g.header.key}>
              <div
                role="presentation"
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  padding: '6px 10px 2px',
                }}
              >
                {g.header.label}
              </div>
              {g.items.map((row) => {
                optIdx += 1
                const idx = optIdx
                return (
                  <button
                    key={row.value}
                    type="button"
                    role="option"
                    aria-selected={idx === activeIdx}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => choose(row)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      fontSize: 13,
                      padding: '6px 10px 6px 20px',
                      background: idx === activeIdx ? 'var(--bg-card-hover)' : 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text)',
                      display: 'block',
                    }}
                  >
                    {row.value}
                  </button>
                )
              })}
            </div>
          ))}
          {canCreate &&
            (() => {
              optIdx += 1
              const idx = optIdx
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => choose({ type: 'create', value: query.trim() })}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    fontSize: 13,
                    padding: '6px 10px',
                    background: idx === activeIdx ? 'var(--bg-card-hover)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--gold)',
                    display: 'block',
                  }}
                >
                  {t('metadata.createDiceMaterial', { name: query.trim() })}
                </button>
              )
            })()}
        </div>
      )}
    </div>
  )
}
