/**
 * Contract tests for frame aperture detection.
 *
 * jsdom has no 2D canvas, so the fill itself cannot run here — its algorithm is
 * verified against real rasterised shapes outside the test suite. What this file
 * pins down is the guard behaviour every caller depends on: a frame that cannot
 * yield an aperture must return null, so the editor falls back to the geometric
 * mask instead of cropping the art to nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { frameApertureMask } from './frameMask'

const frame = { naturalWidth: 512, naturalHeight: 512 }

/** A context whose getImageData returns a canvas of the given uniform alpha. */
function contextWithAlpha(alpha, size) {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = alpha
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data })),
    createImageData: vi.fn((w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })),
    putImageData: vi.fn(),
    globalCompositeOperation: 'source-over',
    filter: 'none',
  }
}

beforeEach(() => vi.restoreAllMocks())

describe('frameApertureMask', () => {
  it('returns null when the frame is opaque at its centre', () => {
    // A solid disc has no interior to fill — there is nothing to crop to.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => contextWithAlpha(255, 256))
    expect(frameApertureMask(frame)).toBeNull()
  })

  it('returns null when the fill escapes to the border', () => {
    // A fully transparent image means the frame encloses nothing, so the fill
    // runs to the edge — the same signal a border with a gap in it produces.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => contextWithAlpha(0, 256))
    expect(frameApertureMask(frame)).toBeNull()
  })

  it('returns null rather than throwing when the canvas is unreadable', () => {
    // A tainted canvas throws on getImageData. Frames are same-origin so this
    // should not arise, but degrading beats breaking the editor.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        throw new Error('tainted')
      }),
    }))
    expect(frameApertureMask(frame)).toBeNull()
  })

  it('returns null when no 2D context is available', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
    expect(frameApertureMask(frame)).toBeNull()
  })

  it('samples at the working size it was given', () => {
    const ctx = contextWithAlpha(255, 64)
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx)
    frameApertureMask(frame, 64)
    expect(ctx.drawImage).toHaveBeenCalledWith(frame, 0, 0, 64, 64)
  })
})
