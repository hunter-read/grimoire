import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import api from '../../api'

/**
 * Single-value combobox with a filterable flat dropdown and an explicit
 * "Create «text»" row for new values — a flat cousin of GenrePicker. The chosen
 * value fills the input; typing filters the options and (when the text matches
 * nothing) offers a create row. Creating best-effort persists the value to the
 * lookup table at `createEndpoint` (admin only) and calls `onCreate` to refresh.
 *
 * Props:
 *   id            – input id (also used for the clear button aria)
 *   value         – current string value
 *   onChange      – (nextValue) => void
 *   options       – array of known string values
 *   placeholder   – input placeholder
 *   createEndpoint – REST path to POST {name} for a new value (optional)
 *   onCreate      – called after a successful create, to reload the lookup list
 *   createLabel   – (name) => string for the create row (defaults to `Create "name"`)
 */
export default function SingleSelectCombobox({
  id,
  value,
  onChange,
  options = [],
  placeholder = '',
  createEndpoint,
  onCreate,
  createLabel,
}) {
  const { t } = useTranslation()
  // `query` mirrors the input; it starts from the committed value and is kept in
  // sync when the value changes from outside.
  const [query, setQuery] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef(null)

  useEffect(() => {
    setQuery(value || '')
  }, [value])

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const q = query.trim().toLowerCase()
  const matches = options.filter((o) => o.toLowerCase().includes(q))
  const exact = options.some((o) => o.toLowerCase() === q)
  const canCreate = q.length > 0 && !exact

  const rows = [
    ...matches.map((name) => ({ type: 'option', name })),
    ...(canCreate ? [{ type: 'create', name: query.trim() }] : []),
  ]

  const commit = (name) => {
    const v = name.trim()
    onChange(v)
    setQuery(v)
    setOpen(false)
  }

  const create = (name) => {
    const v = name.trim()
    if (!v) return
    commit(v)
    // Best-effort persist so the value appears in the list next time. Ignored if
    // not permitted (non-admin) or already exists.
    if (createEndpoint && !options.some((o) => o.toLowerCase() === v.toLowerCase())) {
      api
        .post(createEndpoint, { name: v })
        .then((created) => onCreate && onCreate(created))
        .catch(() => {})
    }
  }

  const choose = (row) => {
    if (!row) return
    if (row.type === 'create') create(row.name)
    else commit(row.name)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIdx((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rows.length) choose(rows[activeIdx] || rows[0])
      else commit(query)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // Typing edits the value directly; picking/creating commits a final one.
            onChange(e.target.value)
            setOpen(true)
            setActiveIdx(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          style={{ width: '100%', paddingRight: query ? 26 : undefined }}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              commit('')
              setOpen(false)
            }}
            aria-label={t('common.clear')}
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              padding: 2,
            }}
          >
            <LuX size={12} />
          </button>
        )}
      </div>
      {open && rows.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            zIndex: 30,
            marginTop: 2,
            maxHeight: 240,
            overflowY: 'auto',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          }}
        >
          {rows.map((row, i) => (
            <button
              key={row.type === 'create' ? '__create__' : row.name}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => choose(row)}
              style={{
                width: '100%',
                textAlign: 'left',
                fontSize: 13,
                padding: '6px 10px',
                background: i === activeIdx ? 'var(--bg-card-hover)' : 'none',
                border: 'none',
                cursor: 'pointer',
                color: row.type === 'create' ? 'var(--gold)' : 'var(--text)',
                display: 'block',
              }}
            >
              {row.type === 'create'
                ? createLabel
                  ? createLabel(row.name)
                  : t('metadata.createValue', { name: row.name })
                : row.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
