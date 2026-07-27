import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { slugify } from '../../constants'

/**
 * Single-value combobox for a book category, matching the GenrePicker feel: one
 * input that filters the known options as you type (shown by their friendly
 * label), lets you pick one, or create a brand-new custom category. The stored
 * value is always a slug; `options` is `[{ value: slug, label }]`.
 */
export default function CategoryPicker({ value, onChange, options }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef(null)

  const labelFor = (slug) => options.find((o) => o.value === slug)?.label || slug

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setEditing(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const q = query.trim().toLowerCase()
  const matches = options.filter(
    (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
  )
  const slugQ = slugify(query)
  const exists = options.some((o) => o.value === slugQ)
  const canCreate = slugQ.length > 0 && !exists

  const rows = [
    ...matches.map((o) => ({ type: 'option', ...o })),
    ...(canCreate ? [{ type: 'create', value: slugQ, label: query.trim() }] : []),
  ]

  const commit = (row) => {
    if (!row) return
    onChange(row.value)
    setEditing(false)
    setOpen(false)
    setQuery('')
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
      commit(rows[activeIdx] || rows[0])
    } else if (e.key === 'Escape') {
      setEditing(false)
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={t('bookEditor.categoryLabel')}
        value={editing ? query : labelFor(value)}
        onFocus={() => {
          setEditing(true)
          setQuery('')
          setOpen(true)
          setActiveIdx(0)
        }}
        onChange={(e) => {
          setEditing(true)
          setQuery(e.target.value)
          setOpen(true)
          setActiveIdx(0)
        }}
        onKeyDown={onKeyDown}
        placeholder={t('bookEditor.categoryPlaceholder')}
        style={{ width: '100%', fontSize: 13 }}
      />
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
              key={row.type === 'create' ? '__create__' : row.value}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => commit(row)}
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
                ? t('bookEditor.createCategory', { name: row.label })
                : row.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
