import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuDownload, LuCopy } from 'react-icons/lu'
import ItemCarouselNav from './ItemCarouselNav'
import { bulk as bulkApi } from '../api'
import SystemBulkEditFields from './system/SystemBulkEditFields'
import BookBulkEditFields from './system/BookBulkEditFields'
import ApplyToAllDialog from './system/ApplyToAllDialog'
import MetadataFetchDialog from './system/MetadataFetchDialog'
import useMetadataSources from './system/useMetadataSources'
import { CONFIG, diffDrafts, seedDrafts } from './bulkEditDrafts'

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
  product_code: 'productCodeLabel',
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
// ISBN or product code identifies one specific book.
const NOT_COPYABLE = new Set(['cover_book_id', 'isbn', 'product_code'])

// One entry of a list-valued field, flattened for the checklist preview.
// Publishers are {name, url}; link lists are {label, url}.
const previewEntry = (entry) => {
  if (entry === null || entry === undefined) return ''
  if (typeof entry !== 'object') return String(entry)
  if (entry.name) return String(entry.name)
  if (entry.label && entry.url) return `${entry.label}: ${entry.url}`
  return String(entry.url || entry.label || '')
}

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

  const [drafts, setDrafts] = useState(() => seedDrafts(items, cfg))

  // Fields the metadata fetch has already written to the server, keyed by item
  // id. The fetch dialog PATCHes as it applies, so these are the items' new
  // saved values: diffing against them keeps "Save all" and the unsaved-changes
  // guard from treating a fetched field as a pending edit, and they are handed
  // to `onSaved` however the modal closes so the parent's list is not left
  // showing the pre-fetch values (issue #466).
  const [fetched, setFetched] = useState({})
  const savedItems = useMemo(
    () => items.map((it) => (fetched[it.id] ? { ...it, ...fetched[it.id] } : it)),
    [items, fetched]
  )

  const current = savedItems[index]
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
  const isLast = index === items.length - 1
  // Undefined at either end, which the navigation bars render as disabled.
  const goPrev = index === 0 ? undefined : () => go(-1)
  const goNext = isLast ? undefined : () => go(1)
  const position = t('bulkEdit.position', { current: index + 1, total: items.length })

  // Each item opens at the top of its form. Without this, paging through the
  // selection kept the scroll offset of the previous item's (differently sized)
  // form, so every step started with a scroll back up.
  const bodyRef = useRef(null)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [index])

  // "Fetch metadata", mirroring the single-item editors. Only offered when the
  // current item actually has an add-on source, so the button never promises
  // something the server cannot do.
  // Cached per kind, so paging through the carousel neither refetches per item
  // nor makes the button pop in a beat after each system renders.
  const metadataKind = cfg.metadataKind
  const { sources: metadataSources } = useMetadataSources(metadataKind, current.id)
  const hasSources = metadataSources.length > 0
  const [fetching, setFetching] = useState(false)
  // The source picked in the fetch dialog, carried from item to item so a
  // batch is not a dropdown change per item.
  const [fetchSourceId, setFetchSourceId] = useState('')
  // Each item's search (query, source, results, last pick), so stepping back
  // to an item shows the same matches — handy when two look-alike books were
  // mixed up — without asking the source again.
  const [fetchMemory, setFetchMemory] = useState({})
  const rememberFetch = (id) => (state) => setFetchMemory((prev) => ({ ...prev, [id]: state }))
  const [applyingAll, setApplyingAll] = useState(false)

  // Dismissing the modal throws the drafts away, which is punishing after
  // editing a large selection — so a dirty modal asks first (issue #256).
  // Checked lazily on dismiss rather than tracked per keystroke.
  const [confirmingClose, setConfirmingClose] = useState(false)
  // Closing still reports fetched fields, which are already saved.
  const close = () => (Object.keys(fetched).length ? onSaved(fetched) : onClose())
  const requestClose = () => {
    if (Object.keys(diffDrafts(savedItems, drafts, cfg)).length) setConfirmingClose(true)
    else close()
  }

  // Keyboard paging for working through a selection (issue #466): ← / → move
  // between items and F opens the fetch. Ignored while typing — these are all
  // keys a text field needs — and while a dialog is open on top.
  const overlayOpen = fetching || applyingAll || confirmingClose
  useEffect(() => {
    if (overlayOpen) return undefined
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (isTextEntry(e.target)) return
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if ((e.key === 'f' || e.key === 'F') && hasSources) setFetching(true)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The fetch dialog PATCHes the fields it applies, so the draft is refreshed
  // to match rather than left holding pre-fetch values that "Save all" would
  // then write back over the top. Values arrive in API shape, which is also the
  // shape the bulk bodies keep (authors and artists as arrays) — the single-book
  // editor's comma-joined form would blank them here.
  const handleFetched = (fields) => {
    const id = current.id
    setFetched((prev) => ({ ...prev, [id]: { ...prev[id], ...fields } }))
    setDrafts((prev) => {
      const d = { ...prev[id] }
      for (const [key, value] of Object.entries(fields)) {
        if (cfg.fields.includes(key)) d[key] = value
      }
      return { ...prev, [id]: d }
    })
  }

  const saveAll = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const changedById = diffDrafts(savedItems, drafts, cfg)

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
      const edited = { ...fetched }
      for (const [id, patch] of Object.entries(changedById)) {
        edited[id] = { ...edited[id], ...patch }
      }
      onSaved(edited)
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
      onClick={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div style={panel}>
        {/* Fixed header: the title and the item navigation stay put while the
            form scrolls, mirroring the footer below. */}
        <header style={header}>
          <div style={titleRow}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {t('bulkEdit.title', { count: items.length })}
            </span>
            <button onClick={requestClose} style={closeBtn} aria-label={t('common.close')}>
              <LuX size={16} />
            </button>
          </div>

          <ItemCarouselNav
            title={itemName(current)}
            subtitle={position}
            onPrev={goPrev}
            onNext={goNext}
            prevLabel={t('bulkEdit.previous')}
            nextLabel={t('bulkEdit.next')}
            shortcuts
          />
        </header>

        {/* Only the form scrolls, between the fixed header and footer. */}
        <div ref={bodyRef} style={body}>
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
        </div>

        <div style={footer}>
          {items.length > 1 && (
            <button onClick={() => setApplyingAll(true)} style={fetchBtn}>
              <LuCopy size={13} />
              {t('bulkEdit.applyToAll', { count: items.length })}
            </button>
          )}
          {hasSources && (
            <button
              onClick={() => setFetching(true)}
              aria-keyshortcuts="F"
              title={t('bulkEdit.fetchShortcut')}
              style={fetchBtn}
            >
              <LuDownload size={13} />
              {t('bookEditor.fetchMetadata')}
            </button>
          )}
          <button onClick={requestClose} style={{ ...cancelBtn, marginLeft: 'auto' }}>
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

      {/* Keyed per item so moving on starts the next item's search fresh,
          while the dialog itself stays open for the whole run. */}
      {fetching && (
        <MetadataFetchDialog
          key={current.id}
          resource={current}
          kind={metadataKind}
          onApply={handleFetched}
          onClose={() => setFetching(false)}
          autoSearch
          initialSourceId={fetchSourceId}
          onSourceChange={setFetchSourceId}
          position={position}
          itemName={itemName(current)}
          onNext={goNext}
          onPrev={goPrev}
          remembered={fetchMemory[current.id]}
          onRemember={rememberFetch(current.id)}
          applied={fetched[current.id]}
        />
      )}

      {confirmingClose && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-discard-title"
          style={confirmOverlay}
          onClick={(e) => e.target === e.currentTarget && setConfirmingClose(false)}
        >
          <div style={confirmPanel}>
            <div id="bulk-discard-title" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
              {t('bulkEdit.discardTitle')}
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
              {t('bulkEdit.discardHint')}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmingClose(false)} style={cancelBtn}>
                {t('bulkEdit.keepEditing')}
              </button>
              <button onClick={close} style={dangerBtn}>
                {t('bulkEdit.discardChanges')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const itemName = (item) => item.filename || item.title || item.name

// Keys typed into these belong to the field, not to the carousel.
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range'])
const isTextEntry = (el) => {
  if (!el?.tagName) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el.tagName === 'INPUT' && !NON_TEXT_INPUTS.has(el.type)
}

const overlay = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--scrim)',
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
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
}
// The scrolling middle of the panel. The small side padding, cancelled by the
// negative margin, leaves room for focus rings that overflow would clip.
const body = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  margin: '0 -4px',
  padding: '0 4px 4px',
}
// Outside the scrolling body, like the footer, so the item navigation is
// always in reach.
const header = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  marginBottom: 16,
  paddingBottom: 16,
  borderBottom: '1px solid var(--border)',
}
const titleRow = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}
const closeBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
}
// Outside the scrolling body, like the header, so "Save all" and "Fetch
// metadata" are always in reach without scrolling.
const footer = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginTop: 16,
  paddingTop: 16,
  borderTop: '1px solid var(--border)',
}
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
const confirmOverlay = {
  position: 'fixed',
  inset: 0,
  // Above the bulk-edit modal itself (1200), matching ApplyToAllDialog.
  zIndex: 1300,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--scrim)',
  padding: 16,
}
const confirmPanel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 24,
  width: 400,
  maxWidth: '94vw',
  boxSizing: 'border-box',
}
const dangerBtn = {
  padding: '7px 18px',
  borderRadius: 6,
  background: 'var(--danger)',
  border: 'none',
  color: 'var(--bg-deep)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}
