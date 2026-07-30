import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import api from '../api'
import SystemBulkEditFields from './system/SystemBulkEditFields'
import BookBulkEditFields from './system/BookBulkEditFields'
import { cleanLinks } from './metadata/metadataUtils'

// Per-type editable fields and the PATCH endpoint they save to. Tags are edited
// as a comma-separated string and split on save.
const CONFIG = {
  map: {
    endpoint: (id) => `/maps/${id}`,
    fields: ['tags', 'grid_size'],
  },
  token: {
    endpoint: (id) => `/tokens/${id}`,
    fields: ['tags', 'is_explicit'],
  },
  audio: {
    endpoint: (id) => `/audio/${id}`,
    fields: ['tags'],
  },
  book: {
    endpoint: (id) => `/books/${id}`,
    // Books use a bespoke editor body (BookBulkEditFields) mirroring the full
    // single-book editor, so genres/tags/authors/artists/links stay native
    // arrays and category uses the shared combobox.
    fields: [
      'title',
      'description',
      'category',
      'genres',
      'tags',
      'urls',
      'authors',
      'artists',
      'publisher',
      'isbn',
      'version',
      'language',
      'year',
      'month',
      'day',
      'is_explicit',
    ],
    custom: true,
  },
  system: {
    endpoint: (id) => `/systems/${id}`,
    // Systems use a bespoke editor body (SystemBulkEditFields) that mirrors the
    // full single-system editor, so tags/publishers/genres/links stay native
    // arrays and the cover image can be picked from each system's own books.
    fields: [
      'description',
      'tags',
      'genres',
      'dice_materials',
      'system_family',
      'license',
      'year',
      'publishers',
      'urls',
      'character_builder_urls',
      'is_explicit',
      'cover_book_id',
    ],
    custom: true,
  },
}

// Fields that are stored as arrays/objects rather than strings — kept as native
// values in the draft (not stringified) and compared by JSON on save.
const STRUCTURED_FIELDS = new Set([
  'publishers',
  'genres',
  'dice_materials',
  'urls',
  'character_builder_urls',
  'authors',
  'artists',
])

// Pull a grid size like "22x22" out of a map's filename or folder, e.g.
// "Sunken Temple (22x22)" → "22x22". Used to pre-fill an empty grid size.
const GRID_RE = /(\d+\s*[x×]\s*\d+)/i
const inferGridSize = (item) => {
  for (const src of [item.filename, item.folder_path, item.relative_path]) {
    const m = typeof src === 'string' && src.match(GRID_RE)
    if (m) return m[1].replace(/\s*[x×]\s*/i, 'x')
  }
  return ''
}

// Normalize a structured field's draft value before compare/save.
const cleanStructured = (field, value) => {
  const list = value || []
  if (field === 'publishers') return list.filter((p) => p.name?.trim())
  if (field === 'urls' || field === 'character_builder_urls') return cleanLinks(list)
  // genres / dice_materials are plain string arrays, already trimmed in the UI.
  return list
}

const tagsToString = (tags) => (Array.isArray(tags) ? tags.join(', ') : '')
const stringToTags = (s) =>
  s
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)

/**
 * Edit a set of items one at a time via a carousel. Receives the selected item
 * objects and a `type` (book|map|token). On save, persists each changed item
 * via its single-item PATCH endpoint and calls `onSaved` with a map of
 * { id: changedFields } so the parent view can patch local state.
 */
export default function BulkEditModal({
  type,
  items,
  onClose,
  onSaved,
  existingCategories = [],
  systemGenres = [],
}) {
  const { t } = useTranslation()
  const cfg = CONFIG[type]
  const [index, setIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Working drafts keyed by item id, seeded from the items' current values.
  // Custom bodies (systems) keep structured fields as native arrays/objects;
  // the generic body stores everything as strings.
  const [drafts, setDrafts] = useState(() => {
    const out = {}
    for (const it of items) {
      const d = {}
      for (const f of cfg.fields) {
        if (f === 'tags') d[f] = cfg.custom ? it.tags || [] : tagsToString(it.tags)
        else if (STRUCTURED_FIELDS.has(f)) d[f] = it[f] || []
        else if (f === 'grid_size') d[f] = it.grid_size || inferGridSize(it)
        else if (f === 'cover_book_id') d[f] = it[f] ?? null
        else d[f] = it[f] ?? ''
      }
      out[it.id] = d
    }
    return out
  })

  const current = items[index]
  const draft = drafts[current.id]
  const fieldLabels = useMemo(
    () => ({
      title: t('bulkEdit.field_title'),
      category: t('bulkEdit.field_category'),
      description: t('bulkEdit.field_description'),
      publisher: t('bulkEdit.field_publisher'),
      year: t('bulkEdit.field_year'),
      tags: t('bulkEdit.field_tags'),
      grid_size: t('bulkEdit.field_gridSize'),
      genre: t('bulkEdit.field_genre'),
      character_builder_url: t('bulkEdit.field_characterBuilderUrl'),
      is_explicit: t('bulkEdit.field_explicit'),
    }),
    [t]
  )

  const setField = (field, value) =>
    setDrafts((prev) => ({ ...prev, [current.id]: { ...prev[current.id], [field]: value } }))

  const go = (delta) => setIndex((i) => Math.min(items.length - 1, Math.max(0, i + delta)))

  const saveAll = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const changedById = {}
      const requests = []
      for (const it of items) {
        const d = drafts[it.id]
        const patch = {}
        for (const f of cfg.fields) {
          if (f === 'tags') {
            const next = cfg.custom ? d.tags : stringToTags(d.tags)
            if (tagsToString(next) !== tagsToString(it.tags)) patch.tags = next
          } else if (STRUCTURED_FIELDS.has(f)) {
            const next = cleanStructured(f, d[f])
            if (JSON.stringify(next) !== JSON.stringify(it[f] || [])) patch[f] = next
          } else if (f === 'is_explicit') {
            if (!!d.is_explicit !== !!it.is_explicit) patch.is_explicit = !!d.is_explicit
          } else if (f === 'cover_book_id') {
            if ((d.cover_book_id ?? null) !== (it.cover_book_id ?? null))
              patch.cover_book_id = d.cover_book_id ?? null
          } else if (f === 'year' || f === 'month' || f === 'day') {
            const next = d[f] === '' || d[f] == null ? null : Number(d[f])
            if (next !== (it[f] ?? null)) patch[f] = next
          } else if ((d[f] ?? '') !== (it[f] ?? '')) {
            patch[f] = d[f]
          }
        }
        if (Object.keys(patch).length) {
          changedById[it.id] = patch
          requests.push(api.patch(cfg.endpoint(it.id), patch))
        }
      }
      await Promise.all(requests)
      onSaved(changedById)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={panel}>
        <div style={header}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            {t('bulkEdit.title', { count: items.length })}
          </span>
          <button onClick={onClose} style={closeBtn} aria-label={t('common.close')}>
            <LuX size={16} />
          </button>
        </div>

        {/* Carousel header */}
        <div style={carouselNav}>
          <button
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label={t('bulkEdit.previous')}
            style={navBtn(index === 0)}
          >
            <LuChevronLeft size={16} />
          </button>
          <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, ...ellipsis }}>
              {current.filename || current.title || current.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t('bulkEdit.position', { current: index + 1, total: items.length })}
            </div>
          </div>
          <button
            onClick={() => go(1)}
            disabled={index === items.length - 1}
            aria-label={t('bulkEdit.next')}
            style={navBtn(index === items.length - 1)}
          >
            <LuChevronRight size={16} />
          </button>
        </div>

        {cfg.custom && type === 'system' ? (
          <SystemBulkEditFields system={current} draft={draft} setField={setField} />
        ) : cfg.custom && type === 'book' ? (
          <BookBulkEditFields
            draft={draft}
            setField={setField}
            existingCategories={existingCategories}
            systemGenres={systemGenres}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {cfg.fields.map((f) => {
              if (f === 'is_explicit') {
                return (
                  <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!draft[f]}
                      onChange={(e) => setField(f, e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 13 }}>{fieldLabels[f]}</span>
                  </label>
                )
              }
              const multiline = f === 'description'
              return (
                <div key={f}>
                  <label style={label}>{fieldLabels[f]}</label>
                  {multiline ? (
                    <textarea
                      value={draft[f]}
                      onChange={(e) => setField(f, e.target.value)}
                      rows={3}
                      style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  ) : (
                    <input
                      value={draft[f]}
                      onChange={(e) => setField(f, e.target.value)}
                      placeholder={f === 'tags' ? t('bulkEdit.tagsPlaceholder') : ''}
                      style={input}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={cancelBtn}>
            {t('common.cancel')}
          </button>
          <button
            onClick={saveAll}
            disabled={saving}
            style={{ ...goldBtn, opacity: saving ? 0.5 : 1 }}
          >
            {saving ? t('bulk.applying') : t('bulkEdit.saveAll')}
          </button>
        </div>
      </div>
    </div>
  )
}

const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const overlay = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)',
  padding: 16,
}
const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 24,
  width: 460,
  maxWidth: '92vw',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxSizing: 'border-box',
}
const header = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 14,
}
const closeBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
}
const carouselNav = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  marginBottom: 16,
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
}
const navBtn = (disabled) => ({
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: disabled ? 'var(--text-muted)' : 'var(--text-dim)',
  cursor: disabled ? 'default' : 'pointer',
  display: 'flex',
  padding: 6,
  opacity: disabled ? 0.5 : 1,
})
const label = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-muted)',
  fontWeight: 500,
  marginBottom: 6,
}
const input = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 14,
  boxSizing: 'border-box',
}
const cancelBtn = {
  padding: '7px 16px',
  borderRadius: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text-dim)',
  fontSize: 14,
  cursor: 'pointer',
}
const goldBtn = {
  padding: '7px 18px',
  borderRadius: 6,
  background: 'var(--gold-dim)',
  border: 'none',
  color: 'var(--bg-deep)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}
