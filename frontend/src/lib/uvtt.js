/**
 * Reading and writing Universal VTT files in the browser.
 *
 * The library-backed editor never needs this: a map has a row, so the server
 * parses the file and assembles the export. A map the user has just dragged in
 * has no row at all, and deliberately so — the token editor set the precedent
 * that "I have a file on my phone" should not require writing anything into a
 * library that is routinely mounted read-only. So the whole round trip happens
 * here instead.
 *
 * The envelope shape mirrors `backend/routers/maps/uvtt.py` exactly, because
 * files produced by either path have to be indistinguishable to an importer.
 * Coordinates are in grid units, colours are 8-digit ARGB hex with alpha first,
 * and a portal's `bounds` is the truth its position and rotation derive from.
 *
 * Format reference: https://arkenforge.com/universal-vtt-files/
 */

/** The `format` value every real exporter writes. */
export const UVTT_FORMAT = 0.3

/** Fallback cell size, matching the backend's: 140px/cell is what packs ship. */
export const DEFAULT_PIXELS_PER_GRID = 140

export const UVTT_EXTENSIONS = ['.uvtt', '.dd2vtt']

/** True when a filename looks like a Universal VTT envelope. */
export const isUvttName = (name) => /\.(uvtt|dd2vtt)$/i.test(name || '')

/**
 * Exporters disagree on key casing, so top-level lookups are case-insensitive.
 * A file written with "Image" rather than "image" is otherwise perfectly valid
 * and would simply appear to have no picture.
 */
const pick = (obj, ...names) => {
  if (!obj || typeof obj !== 'object') return undefined
  const lowered = {}
  for (const [k, v] of Object.entries(obj)) lowered[k.toLowerCase()] = v
  for (const name of names) {
    if (name.toLowerCase() in lowered) return lowered[name.toLowerCase()]
  }
  return undefined
}

const asArray = (value) => (Array.isArray(value) ? value : [])

const finite = (value, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Round to the 4dp the stored/exported documents use. */
const round4 = (value) => Math.round(finite(value) * 10000) / 10000

const point = (raw) => ({ x: round4(pick(raw, 'x')), y: round4(pick(raw, 'y')) })

/** A polyline is only meaningful with two points; shorter runs are dropped. */
const polylines = (raw) =>
  asArray(raw)
    .map((line) => asArray(line).map(point))
    .filter((line) => line.length >= 2)

/**
 * Normalise a colour to bare 8-digit lowercase ARGB hex.
 *
 * Channel order is the single most common bug in UVTT tooling, so a value that
 * cannot be read is replaced by the default rather than passed through to
 * become a wrong colour in an exported file.
 */
const color = (value, fallback) => {
  if (typeof value !== 'string') return fallback
  let v = value.trim().replace(/^#/, '').toLowerCase()
  if (v.length === 6) v = `ff${v}`
  return /^[0-9a-f]{8}$/.test(v) ? v : fallback
}

const portal = (raw) => {
  const bounds = asArray(pick(raw, 'bounds')).map(point)
  if (bounds.length !== 2) return null
  return {
    bounds,
    // True is a door (blocks sight until opened), false a window. This is the
    // discriminator Roll20 reads.
    closed: pick(raw, 'closed') !== false,
    freestanding: pick(raw, 'freestanding') === true,
  }
}

const light = (raw) => {
  const position = pick(raw, 'position')
  if (!position || typeof position !== 'object') return null
  return {
    position: point(position),
    range: round4(pick(raw, 'range')),
    // No scale for intensity is agreed between VTTs, so it rides through as
    // authored rather than being normalised to any one of them.
    intensity: round4(finite(pick(raw, 'intensity'), 1)),
    color: color(pick(raw, 'color'), 'ffffffff'),
    shadows: pick(raw, 'shadows') !== false,
  }
}

/**
 * Pull the editor's document out of a parsed `.uvtt`.
 *
 * Anything unreadable is dropped rather than throwing: a file with one broken
 * light is still a map worth editing, and refusing to open it would be a worse
 * answer than opening it with that light missing.
 */
export function documentFromUvtt(parsed) {
  const environment = pick(parsed, 'environment') || {}
  return {
    line_of_sight: polylines(pick(parsed, 'line_of_sight')),
    objects_line_of_sight: polylines(pick(parsed, 'objects_line_of_sight')),
    portals: asArray(pick(parsed, 'portals')).map(portal).filter(Boolean),
    lights: asArray(pick(parsed, 'lights')).map(light).filter(Boolean),
    environment: {
      baked_lighting: pick(environment, 'baked_lighting') === true,
      ambient_light: color(pick(environment, 'ambient_light'), '00000000'),
    },
  }
}

/** The grid a `.uvtt` states for itself, in pixels per cell. */
export function gridFromUvtt(parsed) {
  const resolution = pick(parsed, 'resolution') || {}
  const size = pick(resolution, 'map_size') || {}
  const px = finite(pick(resolution, 'pixels_per_grid'))
  return {
    pixelsPerGrid: px > 0 ? px : 0,
    width: finite(pick(size, 'x')),
    height: finite(pick(size, 'y')),
  }
}

/**
 * The embedded picture as a `data:` URL the browser can load directly.
 *
 * The envelope does not name the image format, and exporters vary (PNG from
 * Dungeondraft, WebP or JPEG elsewhere), so the type is sniffed from the
 * decoded magic number rather than assumed.
 */
export function imageUrlFromUvtt(parsed) {
  let raw = pick(parsed, 'image')
  if (typeof raw !== 'string' || !raw) return null
  // Some exporters write a full data: URI rather than bare base64.
  if (raw.startsWith('data:')) return raw
  raw = raw.replace(/\s/g, '')
  let head
  try {
    head = atob(raw.slice(0, 16))
  } catch {
    return null
  }
  return `data:${sniffImageMime(head)};base64,${raw}`
}

/** Detect an image type from the first bytes of its decoded form. */
export function sniffImageMime(head) {
  if (head.startsWith('\x89PNG')) return 'image/png'
  if (head.startsWith('\xff\xd8\xff')) return 'image/jpeg'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  return 'application/octet-stream'
}

/**
 * Read a dropped `.uvtt` into everything the editor needs from it.
 *
 * Throws on a file that is not JSON at all — that is worth telling the user
 * about, since it means they picked the wrong file.
 */
export async function readUvttFile(file) {
  const text = await file.text()
  let parsed
  try {
    // Strip a UTF-8 BOM: some exporters write one and JSON.parse rejects it.
    parsed = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new Error('not-json')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('not-uvtt')
  }
  const imageUrl = imageUrlFromUvtt(parsed)
  if (!imageUrl) throw new Error('no-image')
  return {
    imageUrl,
    doc: documentFromUvtt(parsed),
    grid: gridFromUvtt(parsed),
  }
}

/** A portal shaped for export, with position and rotation derived from bounds. */
const portalForExport = (p) => {
  const [a, b] = p.bounds
  return {
    position: { x: round4((a.x + b.x) / 2), y: round4((a.y + b.y) / 2) },
    bounds: [{ ...a }, { ...b }],
    // Emitted because exporters in the wild write all three and importers read
    // one or the other; derived so they can never contradict the bounds.
    rotation: Math.round(Math.atan2(b.y - a.y, b.x - a.x) * 1e6) / 1e6,
    closed: p.closed !== false,
    freestanding: p.freestanding === true,
  }
}

/**
 * Assemble a complete Universal VTT envelope.
 *
 * `imageBase64` is the bare base64 picture with no `data:` prefix — the format
 * carries it that way, and a prefix left in place produces a file that looks
 * fine until an importer tries to decode it.
 */
export function buildUvtt({ imageBase64, pixelWidth, pixelHeight, cellPx, doc }) {
  const px = cellPx > 0 ? cellPx : DEFAULT_PIXELS_PER_GRID
  const d = doc || {}
  const environment = d.environment || {}
  return {
    format: UVTT_FORMAT,
    resolution: {
      map_origin: { x: 0, y: 0 },
      // In cells, so the file stays correct even if the image is rescaled.
      map_size: {
        x: Math.round((finite(pixelWidth) / px) * 100) / 100,
        y: Math.round((finite(pixelHeight) / px) * 100) / 100,
      },
      pixels_per_grid: px,
    },
    line_of_sight: (d.line_of_sight || []).map((line) => line.map((p) => ({ ...p }))),
    objects_line_of_sight: (d.objects_line_of_sight || []).map((line) =>
      line.map((p) => ({ ...p }))
    ),
    portals: (d.portals || []).map(portalForExport),
    environment: {
      baked_lighting: environment.baked_lighting === true,
      ambient_light: color(environment.ambient_light, '00000000'),
    },
    lights: (d.lights || []).map((l) => ({
      position: { ...l.position },
      range: finite(l.range),
      intensity: finite(l.intensity, 1),
      color: color(l.color, 'ffffffff'),
      shadows: l.shadows !== false,
    })),
    image: imageBase64,
  }
}

/**
 * Re-encode an image to base64 WebP, the format real `.uvtt` files carry.
 *
 * A dropped PNG is often many megabytes and base64 adds a third on top, so the
 * file a user downloads would be needlessly huge without this. Quality 85
 * matches the backend's encoder for the same reason it chose it — 90 is
 * visually indistinguishable and materially larger.
 *
 * Falls back to PNG where WebP encoding is unavailable, since a larger file is
 * a far better outcome than a failed export.
 */
export function encodeImageToBase64(image, quality = 0.85) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  let url = canvas.toDataURL('image/webp', quality)
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png')
  return url.split(',')[1] || ''
}

/**
 * Load a URL into an `<img>` the canvas can measure and re-encode.
 *
 * `crossOrigin` is deliberately not set: every URL handed here is a blob: or
 * data: URL created in this document, and setting it would break those without
 * buying anything. That also keeps the canvas untainted, which is what makes
 * `encodeImageToBase64` able to read pixels back out at export time.
 */
export function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image-load'))
    img.src = url
  })
}

/**
 * Recover a cell size from a stated cell *count*.
 *
 * Some files describe their grid only as "20 cells across". Dividing the raster
 * by that count is the difference between opening on a drawn grid and opening
 * on no overlay at all — the same reasoning the library-backed path applies to
 * a grid parsed out of a "(30x40)" filename.
 */
export function guessCellPx(pixelWidth, cellsAcross) {
  if (!pixelWidth || !cellsAcross || cellsAcross <= 0) return DEFAULT_PIXELS_PER_GRID
  return Math.round((pixelWidth / cellsAcross) * 10000) / 10000
}
