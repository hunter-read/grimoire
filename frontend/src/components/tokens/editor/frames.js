import { tokenFrames } from '../../../api'
import { GENERIC_SHAPES, genericFrameUrl, genericShape, isGenericFrame } from './genericFrames'

/**
 * The frame catalogue, in three parts:
 *
 *  - two *generic* shapes (circle, square) generated in the browser,
 *    so they can take any colour the user picks;
 *  - three *themed* defaults (PC, NPC, Opponent) shipped as static SVGs with a
 *    fixed identity colour, because their colour is part of what tells them
 *    apart at a glance;
 *  - whatever the operator has dropped into a `.frames-container` folder under
 *    the token library.
 *
 * The bundled frames are static assets rather than API resources on purpose —
 * they must keep working when the library is empty, unmounted, or unreadable,
 * and they should not cost an authenticated request to draw.
 */

/** The recolourable shapes, listed ahead of the themed frames in the picker. */
export const GENERIC_FRAMES = GENERIC_SHAPES.map((shape) => ({
  id: `generic:${shape}`,
  nameKey: `tokenEditor.shape_${shape}`,
  generic: true,
  builtin: true,
}))

/**
 * Built-in frames, served from `frontend/static/` by Vite's publicDir.
 *
 * The set is deliberately three *shapes*, not three colours: thick round, thin
 * round, and angular. At the 40px a picker tile gets, colour differences vanish
 * in greyscale and for colour-blind users, while a silhouette difference
 * survives. See the authoring notes in each SVG.
 */
export const BUILTIN_FRAMES = [
  { id: 'builtin:pc', nameKey: 'tokenEditor.framePc', url: '/frames/pc.svg', builtin: true },
  { id: 'builtin:npc', nameKey: 'tokenEditor.frameNpc', url: '/frames/npc.svg', builtin: true },
  {
    id: 'builtin:opponent',
    nameKey: 'tokenEditor.frameOpponent',
    url: '/frames/opponent.svg',
    builtin: true,
  },
]

/** Prefix marking a bundled frame. `:` is outside the base64url alphabet the
 *  server uses for its ids, so the two can never collide. */
const BUILTIN_PREFIX = 'builtin:'

export const isBuiltinFrame = (id) => typeof id === 'string' && id.startsWith(BUILTIN_PREFIX)

/**
 * Resolve a frame (or frame id) to the URL its image loads from.
 *
 * `color` applies only to the generic shapes, which are generated on demand;
 * the themed and user frames are files and ignore it.
 */
export function frameUrl(frame, color) {
  if (!frame) return null
  const id = typeof frame === 'string' ? frame : frame.id
  if (!id) return null
  if (isGenericFrame(id)) return genericFrameUrl(genericShape(id), color)
  if (isBuiltinFrame(id)) {
    const builtin = BUILTIN_FRAMES.find((f) => f.id === id)
    return builtin ? builtin.url : null
  }
  return tokenFrames.fileUrl(id)
}

/** True when a frame's appearance responds to the colour picker. */
export const frameIsRecolourable = (id) => isGenericFrame(id)

/**
 * Fetch the catalogue: built-ins first, then user frames grouped by folder.
 *
 * A failure to reach the API is not an error the user needs to see — the
 * built-ins are still perfectly usable — so it degrades to those rather than
 * failing the editor open.
 */
export async function fetchFrames() {
  const builtins = [...GENERIC_FRAMES, ...BUILTIN_FRAMES].map((f) => ({ ...f, group: '' }))
  try {
    const data = await tokenFrames.list()
    const user = (data?.frames || []).map((f) => ({ ...f, builtin: false }))
    return [...builtins, ...user]
  } catch {
    return builtins
  }
}

/**
 * Group a flat catalogue into picker sections, preserving order.
 *
 * Built-ins always lead under their own heading; user frames follow under the
 * folder that holds their `.frames` directory, so a system's frames sit beside
 * that system's tokens.
 */
export function groupFrames(frames) {
  const groups = []
  const index = new Map()
  for (const frame of frames) {
    const key = frame.builtin ? '' : frame.group || ''
    const bucket = frame.builtin ? 'builtin' : `user:${key}`
    if (!index.has(bucket)) {
      index.set(bucket, { key: bucket, builtin: !!frame.builtin, label: key, frames: [] })
      groups.push(index.get(bucket))
    }
    index.get(bucket).frames.push(frame)
  }
  return groups
}

/** Display name for a frame — built-ins are translated, user frames are not. */
export function frameLabel(frame, t) {
  if (!frame) return ''
  return frame.builtin ? t(frame.nameKey) : frame.name
}

/**
 * Whether a frame matches a picker search.
 *
 * Matches the folder as well as the name, because a user who organised frames
 * into "Fantasy Frames" and "Scifi Frames" will reach for the folder name as
 * readily as a filename. An empty query matches everything, so callers can pass
 * the raw input without special-casing it.
 */
export function matchesFrameQuery(frame, query, t) {
  const needle = (query || '').trim().toLowerCase()
  if (!needle) return true
  if (!frame) return false
  const haystack = `${frameLabel(frame, t) || ''} ${frame.group || ''}`.toLowerCase()
  return haystack.includes(needle)
}
