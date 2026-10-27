// Book access levels (issue #258) — the client-side mirror of
// backend/models/access.py. Keep the values in step with that module.
//
// A level names the minimum role that can see the content, so the values line
// up one-to-one with the role names the rest of the app already uses.

export const ACCESS_OPEN = ''
export const ACCESS_GM = 'gm'
export const ACCESS_ADMIN = 'admin'

// The wire spelling of "this book has no opinion; inherit from its system or
// category". Distinct from ACCESS_OPEN, which is an explicit override that
// keeps a book visible inside an otherwise-restricted system. The API sends
// null for inherit and accepts this string on the way back.
export const ACCESS_INHERIT = 'inherit'

// Levels an admin can assign, least restrictive first.
export const ACCESS_LEVELS = [ACCESS_OPEN, ACCESS_GM, ACCESS_ADMIN]

// i18n keys rather than literal text, so the picker stays translatable.
export const ACCESS_LABEL_KEYS = {
  [ACCESS_OPEN]: 'access.levels.open',
  [ACCESS_GM]: 'access.levels.gm',
  [ACCESS_ADMIN]: 'access.levels.admin',
  [ACCESS_INHERIT]: 'access.levels.inherit',
}

// Categories that may never be restricted app-wide. Mirrors
// UNRESTRICTABLE_CATEGORIES in the backend: everyone at the table needs the
// core rules and their character sheet by definition.
export const UNRESTRICTABLE_CATEGORIES = ['core', 'character-sheet']

// Normalise an API value (null | '' | 'gm' | 'admin') to a picker value.
// null becomes the inherit sentinel so a <select> can represent it.
export function toPickerValue(level) {
  return level === null || level === undefined ? ACCESS_INHERIT : level
}

// The inverse: what to send back for a picker value.
export function fromPickerValue(value) {
  return value === ACCESS_INHERIT ? ACCESS_INHERIT : value
}

// Whether a resolved level restricts anyone at all.
export function isRestricted(level) {
  return level === ACCESS_GM || level === ACCESS_ADMIN
}
