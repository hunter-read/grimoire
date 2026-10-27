/**
 * WCAG relative-luminance and contrast-ratio maths.
 *
 * Used by the theme tests to hold the shipped palettes to AA, and available to
 * the theme importer so a user can be warned when a theme they install is
 * unreadable rather than discovering it one unreadable screen at a time.
 */

/** WCAG 2.x relative luminance of a `#rgb` / `#rrggbb` colour. */
export function relativeLuminance(hex) {
  const h = String(hex).trim().replace(/^#/, '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  if (!/^[0-9a-f]{6}$/i.test(full)) return null

  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** Contrast ratio between two hex colours, 1–21, or null if either is unparseable. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** WCAG AA for normal-size body text. */
export const AA_NORMAL = 4.5
/** WCAG AAA for normal-size body text — the High Contrast theme's target. */
export const AAA_NORMAL = 7

/** True when `fg` on `bg` clears the given threshold (AA by default). */
export function meetsContrast(fg, bg, threshold = AA_NORMAL) {
  const r = contrastRatio(fg, bg)
  return r !== null && r >= threshold
}
