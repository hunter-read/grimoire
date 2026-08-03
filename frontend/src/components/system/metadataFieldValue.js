/**
 * Rendering helpers for fetched-metadata values (issue #203).
 *
 * The diff dialog shows heterogeneous field values side by side — plain text,
 * lists, publisher objects, labelled links — so each needs flattening to a
 * readable string.
 */

/** Human-readable one-line rendering of a game-system field value. */
export function formatValue(value) {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.map(formatEntry).filter(Boolean).join(', ')
  return String(value)
}

/** One element of a list-valued field. */
function formatEntry(entry) {
  if (entry === null || entry === undefined) return ''
  if (typeof entry !== 'object') return String(entry)
  // Publishers are {name, url}; urls/character_builder_urls are {label, url}.
  if (entry.name) return String(entry.name)
  if (entry.label && entry.url) return `${entry.label}: ${entry.url}`
  return String(entry.url || entry.label || '')
}

/**
 * Fields whose incoming value should be pre-selected.
 *
 * Only `only_incoming` — where the system has nothing yet — is safe to check by
 * default. A `differs` row would overwrite something the user entered, so it
 * stays unchecked until they say otherwise; `same` has nothing to apply.
 */
export function defaultSelection(fields) {
  return fields.filter((f) => f.status === 'only_incoming').map((f) => f.field)
}

/**
 * i18n key for a field label.
 *
 * The API returns snake_case column names; the existing `systemEditor.*` labels
 * are camelCase, so the differing ones are mapped rather than duplicated.
 */
const LABEL_KEYS = {
  system_family: 'systemFamily',
  parent_system: 'parentSystem',
  dice_materials: 'diceMaterials',
  character_builder_urls: 'characterBuilderUrls',
}

export function labelKey(field) {
  return `systemEditor.${LABEL_KEYS[field] || field}`
}

// Book form fields held as comma-separated text rather than arrays.
const CSV_FIELDS = ['authors', 'artists']
// Book form fields held as strings rather than numbers.
const NUMERIC_TEXT_FIELDS = ['year', 'month', 'day']

/**
 * Convert fetched fields from API shape into BookEditor's form shape.
 *
 * The editor keeps authors/artists as comma-separated text and the date parts
 * as strings, so applied values need converting before they are merged in —
 * otherwise an array would render as "[object Object]" and a number would
 * break the controlled input.
 */
// Fields the server merges rather than replaces, so the diff should show what
// is being *added* rather than the whole resulting list.
const MERGED_FIELDS = ['urls', 'character_builder_urls']

export function isMergedField(field) {
  return MERGED_FIELDS.includes(field)
}

/**
 * The entries in `incoming` that aren't already in `current`, by URL.
 *
 * Link lists come back as a union of what the resource has and what the source
 * offers, so rendering the whole thing buries the one new link among the user's
 * existing ones.
 */
export function addedLinks(current, incoming) {
  const existing = new Set(
    (current || [])
      .map((e) =>
        String(e?.url || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  )
  return (incoming || []).filter(
    (e) =>
      !existing.has(
        String(e?.url || '')
          .trim()
          .toLowerCase()
      )
  )
}

export function intoBookForm(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields)) {
    if (CSV_FIELDS.includes(key)) {
      out[key] = Array.isArray(value) ? value.join(', ') : String(value ?? '')
    } else if (NUMERIC_TEXT_FIELDS.includes(key)) {
      out[key] = value === null || value === undefined ? '' : String(value)
    } else {
      out[key] = value
    }
  }
  return out
}
