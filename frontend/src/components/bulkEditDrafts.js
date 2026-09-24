import { cleanLinks } from './metadata/metadataUtils'

// Draft bookkeeping for BulkEditModal: which fields each item type edits, how
// a draft is seeded from an item, and how drafts are diffed back into patches.
// Kept apart from the modal so the component file stays about the UI.

// Per-type editable fields. Saving goes through the shared bulk endpoint for
// this type (see `bulk` in api.js). Tags are edited as a comma-separated string
// and split on save.
export const CONFIG = {
  map: {
    fields: ['tags', 'grid_size'],
  },
  token: {
    fields: ['tags', 'is_explicit'],
  },
  audio: {
    fields: ['tags'],
  },
  model: {
    fields: ['tags', 'is_explicit'],
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
      'product_code',
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
export const STRUCTURED_FIELDS = new Set([
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

export const tagsToString = (tags) => (Array.isArray(tags) ? tags.join(', ') : '')
export const stringToTags = (s) =>
  s
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)

/**
 * Build the { id: changedFields } patch map for a set of drafts — every field
 * whose draft value differs from the item's current value. Shared by the save
 * path and the unsaved-changes check behind Cancel (issue #256).
 */
export const diffDrafts = (items, drafts, cfg) => {
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
  return changedById
}

/**
 * Working drafts keyed by item id, seeded from the items' current values.
 * Custom bodies (books, systems) keep tags and structured fields as native
 * arrays/objects; the generic body stores everything as strings.
 */
export const seedDrafts = (items, cfg) => {
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
}
