/**
 * Draw-order smoke test for the compositor.
 *
 * `src/lib/**` is excluded from coverage, so this file contributes nothing to
 * the gate. It exists because a reordered draw sequence — filling the background
 * after the art, or clipping the frame — produces a plausible-looking canvas and
 * would ship silently. Asserting the call order against a stub context is the
 * cheapest way to catch that.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  DEFAULT_TRANSFORM,
  OUTPUT_SIZES,
  composeToCanvas,
  drawSpec,
  renderPreview,
} from './tokenCompositor'

/** A 2D context that records the order of the calls we care about. */
function stubContext() {
  const calls = []
  const record =
    (name) =>
    (...args) => {
      calls.push({ name, args })
    }
  return {
    calls,
    clearRect: record('clearRect'),
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    arc: record('arc'),
    rect: record('rect'),
    clip: record('clip'),
    fillRect: record('fillRect'),
    drawImage: record('drawImage'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    set fillStyle(v) {
      calls.push({ name: 'fillStyle', args: [v] })
    },
    set imageSmoothingEnabled(v) {
      calls.push({ name: 'imageSmoothingEnabled', args: [v] })
    },
    set imageSmoothingQuality(v) {
      calls.push({ name: 'imageSmoothingQuality', args: [v] })
    },
    set globalCompositeOperation(v) {
      calls.push({ name: 'globalCompositeOperation', args: [v] })
    },
  }
}

const fakeImage = (w = 800, h = 600) => ({ naturalWidth: w, naturalHeight: h })

let ctx

beforeEach(() => {
  ctx = stubContext()
  // jsdom canvases have no 2d context.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx)
})

const names = () => ctx.calls.map((c) => c.name)
const indexOf = (name) => names().indexOf(name)

const baseSpec = () => ({
  source: fakeImage(),
  frame: fakeImage(512, 512),
  size: 256,
  mask: 'circle',
  background: '#334455',
  transform: DEFAULT_TRANSFORM,
})

describe('drawSpec', () => {
  it('draws background, then art, then the frame', () => {
    composeToCanvas(baseSpec())

    const fill = indexOf('fillRect')
    const draws = ctx.calls.map((c, i) => (c.name === 'drawImage' ? i : -1)).filter((i) => i >= 0)
    expect(draws).toHaveLength(2)
    const [art, frame] = draws

    expect(fill).toBeGreaterThan(-1)
    expect(fill).toBeLessThan(art)
    expect(art).toBeLessThan(frame)
  })

  it('clips the background and the art, but never the frame', () => {
    composeToCanvas(baseSpec())

    const clip = indexOf('clip')
    const restore = indexOf('restore')
    const draws = ctx.calls.map((c, i) => (c.name === 'drawImage' ? i : -1)).filter((i) => i >= 0)

    // Background fill and the art both land inside the clip/restore pair...
    expect(clip).toBeLessThan(indexOf('fillRect'))
    expect(indexOf('fillRect')).toBeLessThan(restore)
    expect(draws[0]).toBeLessThan(restore)
    // ...and the frame lands outside it. A clipped ring would vanish.
    expect(draws[1]).toBeGreaterThan(restore)
  })

  it('uses an arc for a circular mask and a rect for a square one', () => {
    composeToCanvas({ ...baseSpec(), mask: 'circle' })
    expect(names()).toContain('arc')

    ctx = stubContext()
    composeToCanvas({ ...baseSpec(), mask: 'square' })
    expect(names()).toContain('rect')
    expect(names()).not.toContain('arc')
  })

  it('applies no clip when the mask is none', () => {
    composeToCanvas({ ...baseSpec(), mask: 'none' })
    expect(names()).not.toContain('clip')
  })

  it('pans before rotating, so dragging tracks the cursor at any rotation', () => {
    composeToCanvas({
      ...baseSpec(),
      transform: { ...DEFAULT_TRANSFORM, rotation: 90, offsetX: 10, offsetY: 20 },
    })
    expect(indexOf('translate')).toBeLessThan(indexOf('rotate'))
    expect(indexOf('rotate')).toBeLessThan(indexOf('scale'))
  })

  it('folds a flip into the scale sign rather than a separate step', () => {
    composeToCanvas({ ...baseSpec(), transform: { ...DEFAULT_TRANSFORM, flipX: true } })
    const scale = ctx.calls.find((c) => c.name === 'scale')
    expect(scale.args[0]).toBeLessThan(0)
    expect(scale.args[1]).toBeGreaterThan(0)
  })

  it('requests high-quality smoothing before drawing', () => {
    composeToCanvas(baseSpec())
    const quality = ctx.calls.find((c) => c.name === 'imageSmoothingQuality')
    expect(quality.args[0]).toBe('high')
  })

  it('skips the fill for a fully transparent background', () => {
    composeToCanvas({ ...baseSpec(), background: 'transparent' })
    expect(names()).not.toContain('fillRect')

    ctx = stubContext()
    composeToCanvas({ ...baseSpec(), background: '#11223300' })
    expect(names()).not.toContain('fillRect')
  })

  it('scales the frame to the output size regardless of its own dimensions', () => {
    composeToCanvas({ ...baseSpec(), size: 140, frame: fakeImage(512, 512) })
    const frameDraw = ctx.calls.filter((c) => c.name === 'drawImage').at(-1)
    expect(frameDraw.args.slice(1)).toEqual([0, 0, 140, 140])
  })

  it('renders with no source and no frame without throwing', () => {
    expect(() => composeToCanvas({ ...baseSpec(), source: null, frame: null })).not.toThrow()
    expect(names()).not.toContain('drawImage')
  })

  it('sizes the canvas to the requested output', () => {
    const canvas = composeToCanvas({ ...baseSpec(), size: 512 })
    expect(canvas.width).toBe(512)
    expect(canvas.height).toBe(512)
  })
})

describe('frame-shaped masking', () => {
  const fakeMask = () => ({ width: 256, height: 256 })

  it('punches the art to the frame mask instead of a circle', () => {
    composeToCanvas({ ...baseSpec(), frameMask: fakeMask() })
    // destination-in is what crops the art to the frame's own opening.
    const modes = ctx.calls.filter((c) => c.name === 'globalCompositeOperation')
    expect(modes.map((c) => c.args[0])).toContain('destination-in')
  })

  it('does not also apply the geometric mask', () => {
    composeToCanvas({ ...baseSpec(), mask: 'circle', frameMask: fakeMask() })
    // The frame's opening is the authority; intersecting the two would crop
    // tighter than the frame and read as a bug.
    expect(names()).not.toContain('clip')
  })

  it('still applies the geometric mask when the frame has no aperture', () => {
    composeToCanvas({ ...baseSpec(), mask: 'circle', frameMask: null })
    expect(names()).toContain('clip')
    expect(names()).toContain('arc')
  })

  it('draws the frame after the punch, so the border is never cropped', () => {
    composeToCanvas({ ...baseSpec(), frameMask: fakeMask() })
    const restore = names().lastIndexOf('globalCompositeOperation')
    const draws = ctx.calls.map((c, i) => (c.name === 'drawImage' ? i : -1)).filter((i) => i >= 0)
    // The final drawImage is the frame overlay, after compositing finished.
    expect(draws.at(-1)).toBeGreaterThan(restore)
  })
})

describe('renderPreview', () => {
  it('renders at a requested display size instead of the export size', () => {
    const canvas = document.createElement('canvas')
    renderPreview(canvas, { ...baseSpec(), size: 256 }, 840)
    expect(canvas.width).toBe(840)
  })

  it('scales pan offsets with the render size, so the preview matches the file', () => {
    // Offsets are in output pixels. Rendering at 2x without scaling them would
    // pan the art half as far as the exported token does.
    const canvas = document.createElement('canvas')
    renderPreview(
      canvas,
      { ...baseSpec(), size: 256, transform: { ...DEFAULT_TRANSFORM, offsetX: 40, offsetY: -10 } },
      512
    )
    const translate = ctx.calls.find((c) => c.name === 'translate')
    // 512/2 + 40*2 = 336 ; 512/2 - 10*2 = 236
    expect(translate.args).toEqual([336, 236])
  })

  it('leaves the spec untouched when the sizes already agree', () => {
    const canvas = document.createElement('canvas')
    renderPreview(canvas, { ...baseSpec(), size: 256 }, 256)
    expect(canvas.width).toBe(256)
  })

  it('falls back to the export size when no display size is given', () => {
    const canvas = document.createElement('canvas')
    renderPreview(canvas, { ...baseSpec(), size: 140 })
    expect(canvas.width).toBe(140)
  })

  it('shares the draw path with the save path', () => {
    const canvas = document.createElement('canvas')
    renderPreview(canvas, {
      source: fakeImage(),
      frame: null,
      size: 256,
      mask: 'circle',
      background: 'transparent',
      transform: DEFAULT_TRANSFORM,
    })
    expect(names()).toContain('drawImage')
  })

  it('ignores a missing canvas', () => {
    expect(() => renderPreview(null, { size: 256 })).not.toThrow()
  })
})

describe('OUTPUT_SIZES', () => {
  it('offers the sizes real VTTs use, ascending', () => {
    expect(OUTPUT_SIZES).toEqual([...OUTPUT_SIZES].sort((a, b) => a - b))
    expect(OUTPUT_SIZES).toContain(140) // Roll20's native token size
    expect(OUTPUT_SIZES).toContain(256)
  })
})

describe('drawSpec on a context-less canvas', () => {
  it('returns the canvas instead of throwing', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
    const canvas = document.createElement('canvas')
    expect(() => drawSpec(canvas, { size: 256 })).not.toThrow()
  })
})
