/**
 * The recolourable generic frames: a plain circle, square, and hexagon.
 *
 * Unlike the themed three (PC / NPC / Opponent), which ship as static SVG files
 * with a fixed identity colour, these are generated in the browser so they can
 * take any colour the user picks. They exist for the common case where someone
 * wants a clean border in their party's colour rather than a role marker.
 *
 * Each is emitted as a data URI, which the compositor loads exactly like any
 * other frame image — so recolouring needs no special path through the editor.
 * Data URIs are same-origin and do not taint the canvas.
 */

import { resolveIconColor } from '../../campaigns/iconColors'

/** Default when no colour has been chosen — the app's own gold. */
export const DEFAULT_FRAME_COLOR = 'gold'

const STROKE = 18

// Geometry shared with the bundled SVGs: a 512 viewBox, everything inside it.
// The editor crops to a frame's own interior, so these shapes define the crop —
// which is the whole point of offering a hexagon.
const SHAPES = {
  circle: (color) =>
    `<circle cx="256" cy="256" r="238" fill="none" stroke="${color}" stroke-width="${STROKE}"/>`,
  square: (color) =>
    `<rect x="18" y="18" width="476" height="476" rx="24" fill="none" stroke="${color}" ` +
    `stroke-width="${STROKE}" stroke-linejoin="round"/>`,
  // Pointy-top, matching the orientation of a hex battle map.
  hexagon: (color) =>
    `<polygon points="467.3,378 256,500 44.7,378 44.7,134 256,12 467.3,134" fill="none" ` +
    `stroke="${color}" stroke-width="${STROKE}" stroke-linejoin="round"/>`,
}

export const GENERIC_SHAPES = Object.keys(SHAPES)

/**
 * Build a data-URI SVG for one generic frame in the given colour.
 *
 * `color` is an icon-colour token ("gold", "blue", …) or a "#rrggbb" literal —
 * the same vocabulary campaign icons use, validated the same way, so an
 * unrecognised value falls back rather than reaching a style attribute raw.
 */
export function genericFrameUrl(shape, color) {
  const draw = SHAPES[shape]
  if (!draw) return null
  const resolved = resolveIconColor(color, resolveIconColor(DEFAULT_FRAME_COLOR, '#d4a24c'))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    draw(resolved) +
    `</svg>`
  // encodeURIComponent rather than base64: it keeps the payload readable in
  // devtools and avoids a btoa() round-trip that would choke on non-ASCII.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** True for a frame id this module owns. */
export const isGenericFrame = (id) => typeof id === 'string' && id.startsWith('generic:')

/** The shape half of a "generic:<shape>" id. */
export const genericShape = (id) => (isGenericFrame(id) ? id.slice('generic:'.length) : null)
