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

const frame = { naturalWidth: 512, naturalHeight: 512 } as unknown as CanvasImageSource

/** Replace every canvas's `getContext` with a stub (jsdom has none). */
function stubGetContext(impl: () => unknown) {
  HTMLCanvasElement.prototype.getContext = vi.fn(impl) as unknown as HTMLCanvasElement['getContext']
}

/** A context whose getImageData returns a canvas of the given uniform alpha. */
function contextWithAlpha(alpha: number, size: number) {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = alpha
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data })),
    createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })),
    putImageData: vi.fn(),
    globalCompositeOperation: 'source-over',
    filter: 'none',
  }
}

beforeEach(() => vi.restoreAllMocks())

describe('frameApertureMask', () => {
  it('returns null when the frame is opaque at its centre', () => {
    // A solid disc has no interior to fill — there is nothing to crop to.
    stubGetContext(() => contextWithAlpha(255, 256))
    expect(frameApertureMask(frame)).toBeNull()
  })

  it('returns null when the fill escapes to the border', () => {
    // A fully transparent image means the frame encloses nothing, so the fill
    // runs to the edge — the same signal a border with a gap in it produces.
    stubGetContext(() => contextWithAlpha(0, 256))
    expect(frameApertureMask(frame)).toBeNull()
  })

  it('returns null rather than throwing when the canvas is unreadable', () => {
    // A tainted canvas throws on getImageData. Frames are same-origin so this
    // should not arise, but degrading beats breaking the editor.
    stubGetContext(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        throw new Error('tainted')
      }),
    }))
    expect(frameApertureMask(frame)).toBeNull()
  })

  it('returns null when no 2D context is available', () => {
    stubGetContext(() => null)
    expect(frameApertureMask(frame)).toBeNull()
  })

  it('samples at the working size it was given', () => {
    const ctx = contextWithAlpha(255, 64)
    stubGetContext(() => ctx)
    frameApertureMask(frame, 64)
    expect(ctx.drawImage).toHaveBeenCalledWith(frame, 0, 0, 64, 64)
  })

  describe('a frame that encloses its centre', () => {
    const SIZE = 16
    const c = SIZE / 2

    /** A ring of opaque pixels between radius 4 and 6, transparent elsewhere. */
    function ringContext() {
      const data = new Uint8ClampedArray(SIZE * SIZE * 4)
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const r = Math.hypot(x - c, y - c)
          if (r >= 4 && r <= 6) data[(y * SIZE + x) * 4 + 3] = 255
        }
      }
      return {
        ...contextWithAlpha(0, SIZE),
        getImageData: vi.fn(() => ({ data })),
      }
    }

    it('fills the interior and leaves the ring and the outside clear', () => {
      const ctx = ringContext()
      stubGetContext(() => ctx)

      const mask = frameApertureMask(frame, SIZE)

      expect(mask).toBeInstanceOf(HTMLCanvasElement)
      expect(mask!.width).toBe(SIZE)
      expect(mask!.height).toBe(SIZE)
      const written = ctx.putImageData.mock.calls[0][0] as ImageData
      const alphaAt = (x: number, y: number) => written.data[(y * SIZE + x) * 4 + 3]
      expect(alphaAt(c, c)).toBe(255) // the centre
      expect(alphaAt(c + 2, c)).toBe(255) // still inside the ring
      expect(alphaAt(c + 5, c)).toBe(0) // the ring itself
      expect(alphaAt(0, 0)).toBe(0) // outside the frame
    })

    it('grows the mask by a blurred redraw of itself', () => {
      const ctx = ringContext()
      stubGetContext(() => ctx)

      const mask = frameApertureMask(frame, SIZE)

      expect(ctx.drawImage).toHaveBeenLastCalledWith(mask, 0, 0)
      // The filter is reset afterwards, so it does not linger on the context.
      expect(ctx.filter).toBe('none')
    })

    it('returns null when the mask canvas has no 2D context', () => {
      const ctx = ringContext()
      let calls = 0
      // The first canvas (the sample) reads fine; the second (the mask) has none.
      stubGetContext(() => (calls++ === 0 ? ctx : null))
      expect(frameApertureMask(frame, SIZE)).toBeNull()
    })
  })
})
