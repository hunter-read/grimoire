/**
 * ARGB colour handling for the Universal VTT editor (issue #127).
 *
 * The format stores colours as 8-digit hex with **alpha first** and no leading
 * `#` — `ffeccd8b` is opaque warm yellow. Every browser colour input, and every
 * CSS colour, is RGB with alpha last or separate. Getting that order backwards
 * is the single most common bug in UVTT tooling, so the conversion lives here
 * and nothing else in the editor touches the raw string.
 */

const HEX8 = /^[0-9a-f]{8}$/

/** Normalise user/stored input to bare lowercase 8-digit ARGB, or null. */
export function normalizeArgb(value) {
  if (typeof value !== 'string') return null
  let v = value.trim().replace(/^#/, '').toLowerCase()
  if (v.length === 6) v = `ff${v}`
  return HEX8.test(v) ? v : null
}

/** ARGB hex → `#rrggbb`, the form an `<input type="color">` requires. */
export function argbToRgbHex(argb) {
  const v = normalizeArgb(argb)
  return v ? `#${v.slice(2)}` : '#ffffff'
}

/** ARGB hex → alpha as 0–1, for opacity controls and canvas rendering. */
export function argbToAlpha(argb) {
  const v = normalizeArgb(argb)
  return v ? parseInt(v.slice(0, 2), 16) / 255 : 1
}

/** `#rrggbb` + alpha 0–1 → the ARGB hex the file stores. */
export function rgbHexToArgb(rgbHex, alpha = 1) {
  const rgb = (rgbHex || '').trim().replace(/^#/, '').toLowerCase()
  const safe = /^[0-9a-f]{6}$/.test(rgb) ? rgb : 'ffffff'
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${a}${safe}`
}

/** ARGB hex → a CSS `rgba(...)` string for drawing the preview. */
export function argbToCss(argb, alphaScale = 1) {
  const v = normalizeArgb(argb) || 'ffffffff'
  const a = (parseInt(v.slice(0, 2), 16) / 255) * alphaScale
  const r = parseInt(v.slice(2, 4), 16)
  const g = parseInt(v.slice(4, 6), 16)
  const b = parseInt(v.slice(6, 8), 16)
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`
}
