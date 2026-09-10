/**
 * Canvas compositing for the token editor.
 *
 * Lives under `src/lib/` for the same reason `three.js` and `pdfjs.js` do: that
 * directory is excluded from coverage, and a 2D canvas context does not exist
 * under jsdom. Keep the untestable pixel work here and the branching in the
 * components, so their state machines stay testable with this module mocked.
 *
 * Everything is a plain function over a `spec` object. Deliberately not a class:
 * a class invites callers to keep a canvas alive across renders, and a stale
 * canvas is exactly the leak `three.js`'s `dispose` contract exists to prevent.
 */

/** Output edges offered in the UI, in pixels. */
export const OUTPUT_SIZES = [140, 256, 512, 1024]

/** The identity transform — also what the "reset" control restores. */
export const DEFAULT_TRANSFORM = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
}

// A dimensionless SVG (viewBox but no width/height) reports naturalWidth 0 in
// Firefox and Safari. Without a fallback that makes the cover fit Infinity and
// nothing draws at all.
const SVG_FALLBACK_SIZE = 512

/**
 * Decode a URL, File, or Blob into an image plus reliable dimensions.
 *
 * `crossOrigin` is deliberately never set. Every source is same-origin — API
 * paths are root-relative and bundled frames are served from the same host — so
 * the canvas is not tainted and `toBlob` works. Setting `crossOrigin` would
 * switch the request into CORS mode, which drops the HttpOnly session cookie and
 * turns an authenticated image into a 401.
 *
 * Resolves `{ image, width, height, intrinsic }`. `intrinsic` is false when the
 * dimensions are the SVG fallback rather than the file's own.
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const isBlob = typeof Blob !== 'undefined' && src instanceof Blob
    const url = isBlob ? URL.createObjectURL(src) : src
    const image = new Image()

    const cleanup = () => {
      if (isBlob) URL.revokeObjectURL(url)
    }

    image.onload = () => {
      cleanup()
      const intrinsic = image.naturalWidth > 0 && image.naturalHeight > 0
      resolve({
        image,
        width: intrinsic ? image.naturalWidth : SVG_FALLBACK_SIZE,
        height: intrinsic ? image.naturalHeight : SVG_FALLBACK_SIZE,
        intrinsic,
      })
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('Image could not be loaded'))
    }
    image.src = url
  })
}

/** True when a CSS colour string would paint anything at all. */
function hasVisibleFill(color) {
  if (!color || color === 'transparent') return false
  // #rrggbb00 / #rgb0 — an explicit zero alpha.
  const hex = /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i
  if (hex.test(color)) return !/00$/i.test(color)
  const rgba = /^rgba?\([^)]*?,\s*([\d.]+)\s*\)$/i.exec(color)
  if (rgba) return Number(rgba[1]) > 0
  return true
}

/**
 * Clip subsequent drawing to the token's mask. Caller must have saved first.
 *
 * `ctx.clip()` rather than `globalCompositeOperation`: `destination-in` requires
 * the art to be drawn before it can be punched out, which forces the background
 * to be painted afterwards (wrong order for a translucent fill) or into a
 * scratch canvas. One clip call avoids both.
 */
function applyMask(ctx, mask, size) {
  if (mask === 'none') return
  ctx.beginPath()
  if (mask === 'square') {
    ctx.rect(0, 0, size, size)
  } else {
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  }
  ctx.clip()
}

/**
 * Apply pan, rotation, flip, and zoom about the canvas centre.
 *
 * The order is load-bearing, and each choice fixes a specific bug:
 *
 * - Pan *before* rotate, so dragging moves the art in screen space at any
 *   rotation. Rotating first makes a 90°-rotated image travel sideways when the
 *   user drags downward — the classic bug in this kind of editor.
 * - Flip folded into `scale` as a sign rather than a separate step, so flipping
 *   a rotated image mirrors across the *screen* axis, which is what the button
 *   appears to promise.
 * - The cover fit baked in, so `scale` is a user-facing multiplier where 1.0
 *   exactly fills the mask regardless of the source's pixel dimensions.
 *
 * The caller then draws at (-w/2, -h/2, w, h) in source pixels, keeping
 * `drawImage` in its 5-argument form. Letting `clip()` do the cropping avoids
 * source-rectangle arithmetic, which is where sub-pixel bugs live.
 */
function applyTransform(ctx, transform, size, width, height) {
  const t = { ...DEFAULT_TRANSFORM, ...transform }
  const cover = Math.max(size / width, size / height)
  const scale = cover * t.scale

  ctx.translate(size / 2 + t.offsetX, size / 2 + t.offsetY)
  ctx.rotate((t.rotation * Math.PI) / 180)
  ctx.scale(scale * (t.flipX ? -1 : 1), scale * (t.flipY ? -1 : 1))
}

/**
 * Draw a spec into an existing canvas. The single place draw order lives.
 *
 * Three passes, in this order:
 *   1. background fill — clipped to the mask, so a circular token does not paint
 *      colour into the corners the frame will not cover
 *   2. the source art — clipped to the same mask, under the transform
 *   3. the frame overlay — never clipped, because a ring whose outer edge was
 *      trimmed to the mask would simply vanish
 */
export function drawSpec(canvas, spec) {
  const {
    source,
    sourceWidth,
    sourceHeight,
    frame,
    frameMask,
    size,
    mask = 'circle',
    background = 'transparent',
    transform = DEFAULT_TRANSFORM,
  } = spec

  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.clearRect(0, 0, size, size)

  // Downscaling a 2000px portrait into a 256px token is where quality is won or
  // lost; the default bilinear filter aliases visibly at these ratios.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // When the frame supplies its own aperture, the art is drawn into a scratch
  // canvas and punched to that shape. A frame is rarely a circle — a hexagon or
  // an ornate border has an interior no geometric mask describes — so cropping
  // to the frame's real opening is what keeps art from spilling into corners the
  // frame does not cover. `frameMask` is built by lib/frameMask.js.
  const scratch = frameMask ? document.createElement('canvas') : null
  const target = scratch || canvas
  if (scratch) {
    scratch.width = size
    scratch.height = size
  }
  const tctx = scratch ? scratch.getContext('2d') : ctx
  if (!tctx) return canvas

  tctx.imageSmoothingEnabled = true
  tctx.imageSmoothingQuality = 'high'

  tctx.save()
  // A frame mask replaces the geometric one rather than intersecting with it:
  // the frame's opening is the authority on what the token's shape is.
  if (!frameMask) applyMask(tctx, mask, size)

  if (hasVisibleFill(background)) {
    tctx.fillStyle = background
    tctx.fillRect(0, 0, size, size)
  }

  if (source) {
    const width = sourceWidth || source.naturalWidth || SVG_FALLBACK_SIZE
    const height = sourceHeight || source.naturalHeight || SVG_FALLBACK_SIZE
    applyTransform(tctx, transform, size, width, height)
    tctx.drawImage(source, -width / 2, -height / 2, width, height)
  }

  tctx.restore()

  if (scratch) {
    // destination-in keeps only what the mask covers. Safe here, unlike in the
    // geometric path, because this scratch canvas holds nothing but the art and
    // its background — the frame has not been drawn yet.
    tctx.globalCompositeOperation = 'destination-in'
    tctx.drawImage(frameMask, 0, 0, size, size)
    tctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(scratch, 0, 0)
  }

  if (frame) ctx.drawImage(frame, 0, 0, size, size)

  return canvas
}

/** Compose into a fresh offscreen canvas. */
export function composeToCanvas(spec) {
  return drawSpec(document.createElement('canvas'), spec)
}

/**
 * Draw into a canvas the caller owns — the live preview.
 *
 * Shares `drawSpec` with the save path, so what the user sees is what the file
 * contains. A separate preview renderer would drift.
 *
 * `displaySize` decouples the preview's resolution from the export size. The
 * canvas is shown at whatever the layout gives it — often 420 CSS pixels, and
 * double that in backing pixels on a high-DPI screen — so rendering it at the
 * export size would upscale a 256px token more than threefold and look visibly
 * soft while editing. The pixels the user is judging should be the pixels the
 * source can actually supply; the export size still governs what `composeToBlob`
 * produces.
 */
export function renderPreview(canvas, spec, displaySize) {
  if (!canvas) return
  const size = displaySize && displaySize > 0 ? Math.round(displaySize) : spec.size
  if (size === spec.size) {
    drawSpec(canvas, spec)
    return
  }
  // Pan offsets are expressed in output pixels, so rendering at a different
  // resolution has to scale them too — otherwise a drag made at 256 would move
  // the art half as far in a 512 preview, and the preview would stop matching
  // what saves.
  const ratio = size / spec.size
  drawSpec(canvas, {
    ...spec,
    size,
    transform: {
      ...spec.transform,
      offsetX: (spec.transform?.offsetX ?? 0) * ratio,
      offsetY: (spec.transform?.offsetY ?? 0) * ratio,
    },
  })
}

/** Compose and encode as a PNG blob. PNG because tokens need real transparency. */
export function composeToBlob(spec) {
  const canvas = composeToCanvas(spec)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Token could not be encoded'))
    }, 'image/png')
  })
}
