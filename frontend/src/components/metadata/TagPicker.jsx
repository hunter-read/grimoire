import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuX, LuHeart } from 'react-icons/lu'
import { tags as tagsApi } from '../../api'

const GROUP_LIMIT = 10
const DEBOUNCE_MS = 200

/**
 * Single-input tag combobox shared by every tag-editing surface (issue #235).
 * Selected tags render as removable chips above the input (like GenrePicker).
 *
 * Typing (debounced) opens a grouped dropdown:
 *   0. Create "<text>" — when there's no exact match
 *   1. Favorite tags
 *   2. Tags in this field's category + shared tags (limit 10)
 *   3. All remaining tags (limit 10)
 * An empty input shows only favorites (there can be many tags). `resourceType`
 * is the field's category (system|book|map|token|audio); a tag "belongs" to
 * group 2 when its category equals that or is `shared`.
 *
 * Values are stored as the tag's display casing (or the entered text for a new
 * tag); matching/dedup is case-insensitive. `value` is the selected string[];
 * `onChange(next)` receives the updated list.
 */
export default function TagPicker({ value = [], onChange, resourceType = null, placeholder }) {
  const { t } = useTranslation()
  const [allTags, setAllTags] = useState([]) // [{internal, display, category, is_favorite}]
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [menuRect, setMenuRect] = useState(null) // {left, top, width} in viewport coords
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  // Load the whole tag catalog once (unscoped, so every tag's category is known
  // and group 3 can list tags from other categories).
  useEffect(() => {
    let cancelled = false
    tagsApi
      .list()
      .then((r) => !cancelled && setAllTags(r.tags || []))
      .catch(() => !cancelled && setAllTags([]))
    return () => {
      cancelled = true
    }
  }, [])

  // Debounce the query so results don't churn on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(query), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  const selectedKeys = useMemo(() => new Set(value.map((v) => v.trim().toLowerCase())), [value])
  const has = (internal) => selectedKeys.has(internal)

  // The dropdown renders in a portal (position: fixed) so an ancestor with
  // overflow:hidden or a tight width can't clip it. Track the input's rect so the
  // menu sits flush under it, and keep it fresh while open on scroll/resize.
  const measure = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setMenuRect({ left: r.left, top: r.bottom, width: r.width })
  }, [])

  useEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
    // Re-measure when the chip row above the input grows/shrinks (moves the input).
  }, [open, measure, value.length])

  useEffect(() => {
    const onDoc = (e) => {
      // The menu is portalled outside wrapRef, so ignore clicks inside it.
      if (e.target.closest?.('[data-tagpicker-menu]')) return
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const q = debouncedQ.trim().toLowerCase()

  // Build the grouped, flattened option list (with group headers) plus a parallel
  // list of just the selectable rows for keyboard navigation.
  const { flat, options } = useMemo(() => {
    const avail = allTags.filter((tg) => !has(tg.internal))
    const matches = (tg) => !q || tg.internal.includes(q) || tg.display.toLowerCase().includes(q)
    const byPrefixThenName = (a, b) => {
      const ap = a.internal.startsWith(q) || a.display.toLowerCase().startsWith(q)
      const bp = b.internal.startsWith(q) || b.display.toLowerCase().startsWith(q)
      return bp - ap || a.display.localeCompare(b.display)
    }

    let candidates
    if (!q) {
      // Empty input: only favorites (avoid dumping the whole catalog).
      candidates = avail.filter((tg) => tg.is_favorite)
    } else {
      candidates = avail.filter(matches)
    }

    const inThisCategory = (tg) =>
      tg.category === 'shared' || (resourceType && tg.category === resourceType)

    const favorites = candidates.filter((tg) => tg.is_favorite).sort(byPrefixThenName)
    const rest = candidates.filter((tg) => !tg.is_favorite)
    const category = rest.filter(inThisCategory).sort(byPrefixThenName).slice(0, GROUP_LIMIT)
    const inCategoryKeys = new Set(category.map((tg) => tg.internal))
    const remaining = rest
      .filter((tg) => !inCategoryKeys.has(tg.internal))
      .sort(byPrefixThenName)
      .slice(0, GROUP_LIMIT)

    const exact = allTags.some((tg) => tg.internal === q)
    const canCreate = q.length > 0 && !exact && !has(q)

    const groups = [
      canCreate && { header: null, rows: [{ type: 'create', display: query.trim() }] },
      favorites.length && { header: t('tags.groupFavorites'), rows: favorites },
      category.length && { header: t('tags.groupCategory'), rows: category },
      remaining.length && { header: t('tags.groupOther'), rows: remaining },
    ].filter(Boolean)

    // Flatten to render (headers + rows) and to a selectable-only list for nav.
    const flatList = []
    const selectable = []
    for (const g of groups) {
      if (g.header) flatList.push({ kind: 'header', label: g.header })
      for (const row of g.rows) {
        const idx = selectable.length
        flatList.push({ kind: 'option', row, idx })
        selectable.push(row)
      }
    }
    return { flat: flatList, options: selectable }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTags, q, selectedKeys, query, resourceType])

  const addTag = (display) => {
    const v = display.trim()
    if (v && !has(v.toLowerCase())) onChange([...value, v])
    setQuery('')
    setDebouncedQ('')
    setActiveIdx(0)
    setOpen(true)
  }

  const choose = (row) => {
    if (!row) return
    addTag(row.display)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActiveIdx((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (options.length) choose(options[activeIdx] || options[0])
      else if (query.trim()) addTag(query.trim())
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
    // Backspace intentionally does nothing special: it just edits the input
    // text. Removing a selected tag is done via its chip's ✕ button, so an
    // accidental Backspace can't silently delete tags.
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {/* Selected chips (above the input, GenrePicker-style) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
        {value.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('tags.noTags')}</span>
        )}
        {value.map((tag) => (
          <span
            key={tag}
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
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== tag))}
              aria-label={t('tags.removeTag', { tag })}
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
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={t('tags.addTag')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setActiveIdx(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || t('tags.addTagPlaceholder')}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {open &&
        flat.length > 0 &&
        menuRect &&
        createPortal(
          <div
            role="listbox"
            data-tagpicker-menu=""
            style={{
              position: 'fixed',
              left: menuRect.left,
              top: menuRect.top,
              width: menuRect.width,
              zIndex: 1000,
              marginTop: 2,
              maxHeight: 300,
              overflowY: 'auto',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            }}
          >
            {flat.map((entry, i) =>
              entry.kind === 'header' ? (
                <div
                  key={`h-${i}`}
                  style={{
                    padding: '6px 10px 2px',
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                  }}
                >
                  {entry.label}
                </div>
              ) : (
                <button
                  key={entry.row.type === 'create' ? '__create__' : entry.row.internal}
                  type="button"
                  role="option"
                  aria-selected={entry.idx === activeIdx}
                  onMouseEnter={() => setActiveIdx(entry.idx)}
                  onMouseDown={(e) => {
                    // mousedown fires before the input blur, so pick here.
                    e.preventDefault()
                    choose(entry.row)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    fontSize: 13,
                    padding: '6px 10px',
                    background: entry.idx === activeIdx ? 'var(--bg-card-hover)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: entry.row.type === 'create' ? 'var(--gold)' : 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {entry.row.type === 'create' ? (
                    t('tags.createTag', { name: entry.row.display })
                  ) : (
                    <>
                      {entry.row.is_favorite && (
                        <LuHeart size={11} fill="var(--gold)" color="var(--gold)" />
                      )}
                      <span>{entry.row.display}</span>
                      {entry.row.category === 'shared' && (
                        <span
                          style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}
                        >
                          {t('tags.shared')}
                        </span>
                      )}
                    </>
                  )}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
