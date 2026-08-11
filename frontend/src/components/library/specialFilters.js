// "Special" filter values that match on the presence or absence of a field
// rather than on a concrete value — e.g. "systems with no genre" or "systems
// that have any genre at all". They are sentinel strings stored in the same
// `state.filters` slot as a normal value, so saved presets, the active-filter
// count and the clear button all keep working unchanged.
//
// The sentinels use a `__grim:` prefix so they can never collide with a real
// genre/tag/family value coming from the library.

export const FILTER_NONE = '__grim:none__'
export const FILTER_ANY = '__grim:any__'

export const isSpecialFilter = (v) => v === FILTER_NONE || v === FILTER_ANY

/** True when a field holds no value (null/undefined/empty string/empty array). */
export const isEmptyField = (field) => {
  if (Array.isArray(field)) return field.length === 0
  return field === null || field === undefined || String(field).trim() === ''
}

/**
 * Evaluate a single-value (select) filter against a field.
 * Returns true when the item passes. Non-special values fall through to
 * `matchValue`, so callers keep their own comparison semantics.
 */
export const matchSpecial = (field, wanted, matchValue) => {
  if (wanted === FILTER_NONE) return isEmptyField(field)
  if (wanted === FILTER_ANY) return !isEmptyField(field)
  return matchValue(field, wanted)
}

/**
 * Split a multi-select selection into its special sentinels and the plain
 * values, and evaluate the sentinels against `field`.
 * Returns `{ values, pass }` where `values` is the selection minus sentinels
 * and `pass` is false when a sentinel rules the item out.
 */
export const splitSpecial = (selected = [], field) => {
  const values = []
  let pass = true
  for (const v of selected) {
    if (v === FILTER_NONE) {
      if (!isEmptyField(field)) pass = false
    } else if (v === FILTER_ANY) {
      if (isEmptyField(field)) pass = false
    } else {
      values.push(v)
    }
  }
  return { values, pass }
}

/**
 * Prepend the "None"/"Any" entries to an option list for a dropdown.
 * `labels` supplies the translated text; pass `{ none, any }`.
 */
export const withSpecialOptions = (options = [], labels = {}) => [
  { value: FILTER_NONE, label: labels.none, special: true },
  { value: FILTER_ANY, label: labels.any, special: true },
  ...options,
]
