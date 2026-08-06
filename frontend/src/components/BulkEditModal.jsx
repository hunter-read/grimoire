import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuChevronLeft, LuChevronRight, LuDownload, LuCopy } from 'react-icons/lu'
import api, { bulk as bulkApi } from '../api'
import SystemBulkEditFields from './system/SystemBulkEditFields'
import BookBulkEditFields from './system/BookBulkEditFields'
import ApplyToAllDialog from './system/ApplyToAllDialog'
import MetadataFetchDialog from './system/MetadataFetchDialog'
import { intoBookForm } from './system/metadataFieldValue'
import { cleanLinks } from './metadata/metadataUtils'

// Per-type editable fields. Saving goes through the shared bulk endpoint for
// this type (see `bulk` in api.js). Tags are edited as a comma-separated string
// and split on save.
const CONFIG = {
  map: {
    fields: ['tags', 'grid_size'],
  },
  token: {
    fields: ['tags', 'is_explicit'],
  },
  audio: {
    fields: ['tags'],
  },
  book: {
    // Metadata add-ons serve books and systems; the carousel offers the same
    // "Fetch metadata" step the single-item editors do (issue #260).
    metadataKind: 'books',
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
      // BookBulkEditFields renders a license combobox; without it here the
      // draft was built and edited but never diffed, so the edit was dropped.
      'license',
      'year',
      'month',
      'day',
      'is_explicit',
    ],
    custom: true,
  },
  system: {
    metadataKind: 'systems',
    // Systems use a bespoke editor body (SystemBulkEditFields) that mirrors the
    // full single-system editor, so tags/publishers/genres/links stay native
    // arrays and the cover image can be picked from each system's own books.
    fields: [
      'description',
      'tags',
      'genres',
      'dice_materials',
      'system_family',
      // Rendered by SystemBulkEditFields; without them here the edits were
      // built into the draft but never diffed, so they were silently dropped.
      'parent_system',
      'edition',
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

// i18n keys for the "apply to all" checklist. The single-item editors already
// label every one of these fields, so their keys are reused rather than adding
// a parallel set of bulkEdit.* strings to all ten locales.
const BOOK_LABEL_KEYS = {
  title: 'titleLabel',
  description: 'descriptionLabel',
  category: 'categoryLabel',
  genres: 'genresLabel',
  tags: 'tagsLabel',
  urls: 'urlsLabel',
  authors: 'authorsLabel',
  artists: 'artistsLabel',
  publisher: 'publisherLabel',
  isbn: 'isbnLabel',
  version: 'versionLabel',
  language: 'languageLabel',
  license: 'licenseLabel',
  year: 'yearLabel',
  month: 'monthLabel',
  day: 'dayLabel',
}
const SYSTEM_LABEL_KEYS = {
  description: 'description',
  tags: 'tags',
  genres: 'genres',
  dice_materials: 'diceMaterials',
  system_family: 'systemFamily',
  parent_system: 'parentSystem',
  edition: 'edition',
  license: 'license',
  year: 'year',
  publishers: 'publishers',
  urls: 'urls',
  character_builder_urls: 'characterBuilderUrls',
}

// Fields excluded from "apply to all" because copying them across the selection
// is never meaningful: a cover book id only belongs to its own system, and an
// ISBN identifies one specific book.
const NOT_COPYABLE = new Set(['cover_book_id', 'isbn'])

// One entry of a list-valued field, flattened for the checklist preview.
// Publishers are {name, url}; link lists are {label, url}.
const previewEntry = (entry) => {
  if (entry === null || entry === undefined) return ''
  if (typeof entry !== 'object') return String(entry)
  if (entry.name) return String(entry.name)
  if (entry.label && entry.url) return `${entry.label}: ${entry.url}`
  return String(entry.url || entry.label || '')
}

const tagsToString = (tags) => (Array.isArray(tags) ? tags.join(', ') : '')
const stringToTags = (s) =>
  s
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)

/**
 * Edit a set of items one at a time via a carousel. Receives the selected item
 * objects and a `type` (book|map|token|audio|system). On save, persists every
 * changed item in a single bulk request and calls `onSaved` with a map of
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

  // Copy the current item's values for the chosen fields onto every other
  // selected item's draft (issue #260). Nothing is written until "Save all", so
  // this stays reviewable — step through the carousel and the change is visible
  // on each item. Arrays/objects are cloned so drafts don't share a reference.
  const applyFieldsToAll = (fields) => {
    const source = drafts[current.id] || {}
    setDrafts((prev) => {
      const next = { ...prev }
      for (const it of items) {
        const d = { ...next[it.id] }
        for (const f of fields) {
          const v = source[f]
          d[f] = v && typeof v === 'object' ? structuredClone(v) : v
        }
        next[it.id] = d
      }
      return next
    })
  }

  // The checklist rows: every copyable field for this type, with a label and a
  // preview of the value that would be pushed to the rest of the selection.
  const copyableFields = useMemo(() => {
    const labelFor = (f) => {
      if (type === 'book' && BOOK_LABEL_KEYS[f]) return t(`bookEditor.${BOOK_LABEL_KEYS[f]}`)
      if (type === 'system' && SYSTEM_LABEL_KEYS[f])
        return t(`systemEditor.${SYSTEM_LABEL_KEYS[f]}`)
      if (f === 'is_explicit') return t('bulkEdit.field_explicit')
      return fieldLabels[f] || f
    }
    return cfg.fields
      .filter((f) => !NOT_COPYABLE.has(f))
      .map((f) => ({ field: f, label: labelFor(f) }))
  }, [cfg.fields, type, t, fieldLabels])

  // One-line renderings of the current draft's values, shown beside each row so
  // the choice is informed — particularly for fields that are currently empty.
  const fieldPreviews = useMemo(() => {
    const out = {}
    for (const { field: f } of copyableFields) {
      const v = draft?.[f]
      if (f === 'is_explicit') out[f] = v ? t('common.yes') : t('common.no')
      else if (Array.isArray(v)) out[f] = v.map(previewEntry).filter(Boolean).join(', ')
      else out[f] = v == null ? '' : String(v)
    }
    return out
  }, [copyableFields, draft, t])

  const go = (delta) => setIndex((i) => Math.min(items.length - 1, Math.max(0, i + delta)))

  // "Fetch metadata", mirroring the single-item editors. Only offered when the
  // current item actually has an add-on source, so the button never promises
  // something the server cannot do.
  const [hasSources, setHasSources] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [applyingAll, setApplyingAll] = useState(false)
  const metadataKind = cfg.metadataKind

  useEffect(() => {
    if (!metadataKind) return undefined
    let active = true
    api
      .get(`/${metadataKind}/${current.id}/metadata-sources`)
      .then((data) => active && setHasSources((data.sources || []).length > 0))
      .catch(() => active && setHasSources(false))
    return () => {
      active = false
    }
  }, [metadataKind, current.id])

  // The fetch dialog PATCHes the fields it applies, so the draft is refreshed
  // to match rather than left holding pre-fetch values that "Save all" would
  // then write back over the top.
  const handleFetched = (fields) => {
    const applied = type === 'book' ? intoBookForm(fields) : fields
    setDrafts((prev) => {
      const d = { ...prev[current.id] }
      for (const [key, value] of Object.entries(applied)) {
        if (!cfg.fields.includes(key)) continue
        d[key] = key === 'tags' && !cfg.custom ? tagsToString(value) : value
      }
      return { ...prev, [current.id]: d }
    })
  }

  const saveAll = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const changedById = {}
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
        if (Object.keys(patch).length) changedById[it.id] = patch
      }

      const changes = Object.entries(changedById).map(([id, patch]) => ({ id, ...patch }))
      if (changes.length) {
        // One request for the whole batch: the old per-item PATCH fan-out raced
        // on tag creation server-side and 500'd (issue #270).
        const { errors } = await bulkApi.update(type, changes)
        if (errors?.length) {
          // Items the server rejected individually (unknown id, name clash) must
          // not be reported to the parent as saved.
          for (const { id } of errors) delete changedById[id]
          setError(errors.map((e) => e.detail).join('; '))
          return
        }
      }
      onSaved(changedById)
    } catch (err) {
      setError(err.message)
    } finally {
      // Always released, so a failed save re-enables the button rather than
      // leaving it stuck on "Applying" (issue #270).
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

        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginTop: 20,
          }}
        >
          {items.length > 1 && (
            <button onClick={() => setApplyingAll(true)} style={fetchBtn}>
              <LuCopy size={13} />
              {t('bulkEdit.applyToAll', { count: items.length })}
            </button>
          )}
          {hasSources && (
            <button onClick={() => setFetching(true)} style={fetchBtn}>
              <LuDownload size={13} />
              {t('bookEditor.fetchMetadata')}
            </button>
          )}
          <button onClick={onClose} style={{ ...cancelBtn, marginLeft: 'auto' }}>
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

      {applyingAll && (
        <ApplyToAllDialog
          fields={copyableFields}
          count={items.length}
          values={fieldPreviews}
          onApply={applyFieldsToAll}
          onClose={() => setApplyingAll(false)}
        />
      )}

      {fetching && (
        <MetadataFetchDialog
          resource={current}
          kind={metadataKind}
          onApply={handleFetched}
          onClose={() => setFetching(false)}
        />
      )}
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
  // Matches the metadata fetch dialog and gives the book/system bodies room for
  // the same two-up field layout the single-item editors use (issue #260).
  width: 640,
  maxWidth: '94vw',
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
const fetchBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  borderRadius: 6,
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text-dim)',
  fontSize: 13,
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
