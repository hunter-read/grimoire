/**
 * What a map offers to edit in the Universal VTT editor.
 *
 * Three situations, and the difference between them is what the user is handed:
 *
 *  - A plain raster map has one thing to edit — itself. Walls, doors and lights
 *    are authored over the picture and leave as an exported `.uvtt`.
 *  - A standalone `.uvtt` also has one thing to edit, but it already *carries*
 *    geometry. Opening it means editing what the file holds, not starting over.
 *  - A raster map linked to a `.uvtt` has two, and only the user knows which one
 *    they mean. Silently picking one (or, as before, offering neither) is the
 *    thing to avoid: a pair is exactly the case where the choice is real.
 *
 * PDFs, videos and archives are excluded throughout. None of them is a single
 * raster to draw over, so there is nothing to calibrate a grid against — the
 * same reason the export has always refused them.
 */

/** True when this map's filename is a Universal VTT envelope. */
export const isVttFile = (item) => /\.(uvtt|dd2vtt)$/i.test(item?.filename || '')

/**
 * The `.uvtt` linked to a map, if any.
 *
 * The link is what matters, not the name — the duplicate manager lets anyone
 * pair two files whatever they are called — so this reads the variant family.
 * `kind` is the signal when the link was categorised; a link made without one
 * falls back to the sibling's extension. Mirrors the server's own check.
 */
export const linkedVtt = (map) =>
  (map?.variants || []).find(
    (v) => v.id !== map.id && (v.kind === 'universal-vtt' || isVttFile(v))
  ) || null

/**
 * The editable targets for a map, in the order they should be offered.
 *
 * Each entry is `{ id, kind }` — `kind` being `'image'` or `'vtt'`, which is
 * what decides the label the caller shows. An empty list means the map has
 * nothing to edit and no button should appear at all.
 */
export function editTargets(map) {
  if (!map) return []
  // Anything without a single still raster is out: a PDF has pages, a video has
  // frames, an archive has no image at all.
  if (map.is_pdf || map.media_kind === 'video' || map.media_kind === 'archive' || map.is_archive) {
    return []
  }

  if (isVttFile(map) || map.media_kind === 'vtt') {
    return [{ id: map.id, kind: 'vtt', filename: map.filename }]
  }

  const linked = linkedVtt(map)
  const targets = [{ id: map.id, kind: 'image', filename: map.filename }]
  if (linked) targets.push({ id: linked.id, kind: 'vtt', filename: linked.filename })
  return targets
}

/**
 * Whether a fresh `.uvtt` can be *exported* for this map.
 *
 * Narrower than editability on purpose: a raster already paired with a real
 * `.uvtt` has nothing to gain from ours, since the linked file carries the
 * walls and lights and a generated one would carry none of them. The `.uvtt`
 * itself exports fine — it is the half holding the geometry.
 */
export const canExportUvtt = (map) => {
  const targets = editTargets(map)
  if (targets.length === 0) return false
  if (isVttFile(map) || map.media_kind === 'vtt') return true
  return !linkedVtt(map)
}
