// Icon tint options for campaign tree entries.
//
// A stored tint is either a preset token (below) or a "#rrggbb" literal; null /
// "" means "inherit the row's text colour". The backend validates the same two
// shapes (see `clean_icon_color` in routers/campaigns/_schemas.py), so anything
// reaching the UI is already one of them — but resolveIconColor still guards,
// since a stored value ends up in a style attribute.

// Preset tokens map to fixed hex values rather than theme variables: the tint is
// a deliberate user choice, so it should look the same in light and dark mode.
// These are picked to stay legible against both themes' panel backgrounds.
export const ICON_COLOR_PRESETS = {
  red: '#e05252',
  orange: '#e08a3c',
  gold: '#d4a24c',
  green: '#5aa469',
  teal: '#3fa6a0',
  blue: '#5590d4',
  purple: '#9b72d0',
  pink: '#d472a8',
  brown: '#a1785a',
  gray: '#8a8f98',
}

export const ICON_COLOR_NAMES = Object.keys(ICON_COLOR_PRESETS)

const HEX_RE = /^#[0-9a-f]{6}$/

// True when `value` is a shape we're willing to put in a style attribute.
export function isValidIconColor(value) {
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  return v in ICON_COLOR_PRESETS || HEX_RE.test(v)
}

// A stored tint → a CSS colour, or `fallback` when unset/unrecognized.
export function resolveIconColor(value, fallback = undefined) {
  if (typeof value !== 'string') return fallback
  const v = value.trim().toLowerCase()
  if (v in ICON_COLOR_PRESETS) return ICON_COLOR_PRESETS[v]
  if (HEX_RE.test(v)) return v
  return fallback
}
