/**
 * Derive a token's crop from the frame's own shape.
 *
 * Frames are rarely circles. A hexagonal border, an ornate cartouche, or a
 * user's own irregular art all have an interior that is not a disc, and cropping
 * such a frame to a fixed circle leaves art spilling into the corners the frame
 * does not cover — or clips away area the frame would happily have shown.
 *
 * So the mask is read from the frame itself: flood-fill inward from the centre
 * through the frame's transparent pixels, and whatever the fill reaches is the
 * aperture. That handles any shape without asking the frame to declare one,
 * which matters because user-supplied frames carry no metadata at all.
 *
 * Lives in `src/lib/` alongside the compositor for the reason given there: it is
 * pixel work, jsdom has no canvas, and the directory is coverage-excluded.
 */

// Alpha at or below this counts as "see-through" for the fill. Not zero: frame
// edges are antialiased, and a strict test would let the fill seep through the
// partially-transparent rim and escape into the world outside the frame.
const TRANSPARENT_MAX = 40

// The fill is computed at a fixed working size rather than the output size:
// masks are smooth shapes, a 256-wide fill is plenty to describe one, and it
// keeps the cost flat when someone exports at 1024.
const WORK_SIZE = 256

/**
 * Build a mask canvas from a frame image, or return null when the frame has no
 * enclosed interior (a frame that is solid to its centre, or fully opaque).
 *
 * The returned canvas is white where art should show and transparent elsewhere,
 * ready to use as a compositing mask at any output size.
 */
export function frameApertureMask(frameImage, size = WORK_SIZE) {
  const source = document.createElement('canvas')
  source.width = size
  source.height = size
  const sctx = source.getContext('2d')
  if (!sctx) return null

  sctx.clearRect(0, 0, size, size)
  sctx.drawImage(frameImage, 0, 0, size, size)

  let pixels
  try {
    pixels = sctx.getImageData(0, 0, size, size).data
  } catch {
    // A tainted canvas would throw here. Frames are same-origin, so this should
    // not happen — but returning null degrades to the geometric mask rather
    // than breaking the editor.
    return null
  }

  // The centre must itself be transparent, or there is no interior to fill.
  const centre = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4
  if (pixels[centre + 3] > TRANSPARENT_MAX) return null

  // Breadth-first flood fill from the centre. A typed array as the queue keeps
  // this allocation-free; at 256x256 the whole thing is well under a millisecond.
  const inside = new Uint8Array(size * size)
  const queue = new Int32Array(size * size)
  let head = 0
  let tail = 0

  const start = Math.floor(size / 2) * size + Math.floor(size / 2)
  inside[start] = 1
  queue[tail++] = start

  while (head < tail) {
    const index = queue[head++]
    const x = index % size
    const y = (index - x) / size

    // Four-way rather than eight-way: a diagonal step can slip through a
    // one-pixel gap where two frame strokes meet only at a corner, which would
    // leak the fill outside the frame entirely.
    if (x > 0) push(index - 1)
    if (x < size - 1) push(index + 1)
    if (y > 0) push(index - size)
    if (y < size - 1) push(index + size)
  }

  function push(next) {
    if (inside[next]) return
    if (pixels[next * 4 + 3] > TRANSPARENT_MAX) return
    inside[next] = 1
    queue[tail++] = next
  }

  // A fill that reached the border escaped the frame — the frame does not
  // enclose its centre, so there is no aperture to speak of.
  for (let i = 0; i < size; i++) {
    if (inside[i]) return null // top row
    if (inside[(size - 1) * size + i]) return null // bottom row
    if (inside[i * size]) return null // left column
    if (inside[i * size + size - 1]) return null // right column
  }

  const mask = document.createElement('canvas')
  mask.width = size
  mask.height = size
  const mctx = mask.getContext('2d')
  if (!mctx) return null

  const out = mctx.createImageData(size, size)
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue
    const p = i * 4
    out.data[p] = 255
    out.data[p + 1] = 255
    out.data[p + 2] = 255
    out.data[p + 3] = 255
  }
  mctx.putImageData(out, 0, 0)

  // Grow the mask by a pixel so it tucks under the frame's antialiased inner
  // edge. Without this the fill stops at the first faintly-opaque pixel and a
  // hairline of background shows between art and frame.
  mctx.globalCompositeOperation = 'source-over'
  mctx.filter = 'blur(1px)'
  mctx.drawImage(mask, 0, 0)
  mctx.filter = 'none'

  return mask
}
