import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import api from '../../api'
import { buildGenreTree } from './metadataUtils'

/**
 * Tiered, single-input combobox multi-select for genres. Selected genres show
 * as removable chips. Typing in the one input filters the curated tiered list
 * (indented by depth) as a dropdown; picking an option adds it. If the typed
 * text matches no existing genre, a "Create «text»" row lets you add a custom
 * genre, which is also persisted to the lookup list (best-effort) so it appears
 * next time.
 */
export default function GenrePicker({
  genreTree,
  selected,
  onChange,
  onGenreCreated,
  inheritGenres = null,
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef(null)

  const tree = buildGenreTree(genreTree)
  const has = (name) => selected.some((g) => g.toLowerCase() === name.toLowerCase())

  // "Inherit from system": merge the system's genres into the book's, keeping
  // any extras the book already has and never duplicating (case-insensitive).
  const inheritable = (inheritGenres || []).filter((g) => !has(g))
  const inheritFromSystem = () => {
    if (inheritable.length) onChange([...selected, ...inheritable])
  }

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const q = query.trim().toLowerCase()
  // Options not already selected, filtered by the query (substring match).
  const matches = tree.filter((g) => !has(g.name) && g.name.toLowerCase().includes(q))
  const exact = tree.some((g) => g.name.toLowerCase() === q)
  const canCreate = q.length > 0 && !exact

  // Build the concrete option rows (existing matches, then an optional create row).
  const rows = [
    ...matches.map((g) => ({ type: 'genre', ...g })),
    ...(canCreate ? [{ type: 'create', name: query.trim() }] : []),
  ]

  const addGenre = (name) => {
    const v = name.trim()
    if (v && !has(v)) onChange([...selected, v])
  }

  const createGenre = (name) => {
    const v = name.trim()
    if (!v) return
    addGenre(v)
    // Best-effort: persist as a lookup value so it shows in the list later.
    // Ignored if not permitted (non-admin) or already exists.
    if (!tree.some((g) => g.name.toLowerCase() === v.toLowerCase())) {
      api
        .post('/genres', { name: v })
        .then((created) => onGenreCreated && onGenreCreated(created))
        .catch(() => {})
    }
  }

  const choose = (row) => {
    if (!row) return
    if (row.type === 'create') createGenre(row.name)
    else addGenre(row.name)
    setQuery('')
    setActiveIdx(0)
    setOpen(true)
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
      choose(rows[activeIdx] || rows[0])
    } else if (e.key === 'Backspace' && !query && selected.length > 0) {
      onChange(selected.slice(0, -1))
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
        {selected.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('metadata.noGenres')}</span>
        )}
        {selected.map((g) => (
          <span
            key={g}
            style={{
              fontSize: 12,
              padding: '2px 6px 2px 8px',
              borderRadius: 10,
              background: 'rgba(201,168,76,0.15)',
              border: '1px solid var(--gold-dim)',
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
        aria-label={t('metadata.addGenre')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActiveIdx(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t('metadata.genreComboPlaceholder')}
        style={{ width: '100%' }}
      />
      {inheritGenres !== null && (
        <button
          type="button"
          onClick={inheritFromSystem}
          disabled={inheritable.length === 0}
          style={{
            marginTop: 6,
            fontSize: 12,
            padding: '3px 8px',
            borderRadius: 6,
            background: 'none',
            border: '1px solid var(--border)',
            cursor: inheritable.length ? 'pointer' : 'not-allowed',
            color: inheritable.length ? 'var(--gold)' : 'var(--text-muted)',
            opacity: inheritable.length ? 1 : 0.6,
          }}
        >
          {t('metadata.inheritFromSystem')}
        </button>
      )}
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
              key={row.type === 'create' ? '__create__' : row.id}
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
                paddingLeft: row.type === 'genre' ? 10 + row.depth * 16 : 10,
                background: i === activeIdx ? 'var(--bg-card-hover)' : 'none',
                border: 'none',
                cursor: 'pointer',
                color: row.type === 'create' ? 'var(--gold)' : 'var(--text)',
                display: 'block',
              }}
            >
              {row.type === 'create'
                ? t('metadata.createGenre', { name: row.name })
                : `${row.depth > 0 ? '└ ' : ''}${row.name}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
