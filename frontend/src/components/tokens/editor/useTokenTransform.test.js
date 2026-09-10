import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import useTokenTransform, {
  MAX_SCALE,
  MIN_SCALE,
  clampOffset,
  clampScale,
  wrapRotation,
} from './useTokenTransform'

describe('clamping helpers', () => {
  it('holds scale inside the usable range', () => {
    expect(clampScale(0.001)).toBe(MIN_SCALE)
    expect(clampScale(999)).toBe(MAX_SCALE)
    expect(clampScale(2)).toBe(2)
  })

  it('wraps rotation into [0, 360)', () => {
    expect(wrapRotation(0)).toBe(0)
    expect(wrapRotation(370)).toBe(10)
    expect(wrapRotation(-90)).toBe(270)
    expect(wrapRotation(-450)).toBe(270)
    expect(wrapRotation(360)).toBe(0)
  })

  it('bounds the offset to one output edge either way', () => {
    expect(clampOffset(500, 256)).toBe(256)
    expect(clampOffset(-500, 256)).toBe(-256)
    expect(clampOffset(10, 256)).toBe(10)
  })
})

const setup = (size = 256) => renderHook(() => useTokenTransform(size))

describe('useTokenTransform', () => {
  it('starts at the identity transform', () => {
    const { result } = setup()
    expect(result.current.transform).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      flipX: false,
      flipY: false,
    })
    expect(result.current.isDefault()).toBe(true)
  })

  it('accumulates pans', () => {
    const { result } = setup()
    act(() => result.current.pan(10, -5))
    act(() => result.current.pan(4, 5))
    expect(result.current.transform.offsetX).toBe(14)
    expect(result.current.transform.offsetY).toBe(0)
  })

  it('never lets the art be dragged out of frame', () => {
    const { result } = setup(256)
    act(() => result.current.pan(10000, -10000))
    expect(result.current.transform.offsetX).toBe(256)
    expect(result.current.transform.offsetY).toBe(-256)
  })

  it('zooms by a factor within the clamp', () => {
    const { result } = setup()
    act(() => result.current.zoomBy(2))
    expect(result.current.transform.scale).toBe(2)
    act(() => result.current.zoomBy(100))
    expect(result.current.transform.scale).toBe(MAX_SCALE)
  })

  it('holds the point under the cursor fixed when zooming toward it', () => {
    const { result } = setup(256)
    // Zooming 2x about a point 40px right of centre pushes the offset out so the
    // art under that point does not slide away.
    act(() => result.current.zoomAt(2, 40, 0))
    expect(result.current.transform.scale).toBe(2)
    expect(result.current.transform.offsetX).toBe(-40)
    expect(result.current.transform.offsetY).toBe(0)
  })

  it('leaves state untouched when a zoom is already clamped', () => {
    const { result } = setup()
    act(() => result.current.setScale(MAX_SCALE))
    const before = result.current.transform
    act(() => result.current.zoomAt(2, 40, 40))
    expect(result.current.transform).toEqual(before)
  })

  it('rotates cumulatively and wraps', () => {
    const { result } = setup()
    act(() => result.current.rotate(90))
    act(() => result.current.rotate(300))
    expect(result.current.transform.rotation).toBe(30)
  })

  it('sets rotation absolutely', () => {
    const { result } = setup()
    act(() => result.current.setRotation(-90))
    expect(result.current.transform.rotation).toBe(270)
  })

  it('toggles each flip independently', () => {
    const { result } = setup()
    act(() => result.current.flipX())
    expect(result.current.transform).toMatchObject({ flipX: true, flipY: false })
    act(() => result.current.flipY())
    act(() => result.current.flipX())
    expect(result.current.transform).toMatchObject({ flipX: false, flipY: true })
  })

  it('sets an absolute offset, clamped', () => {
    const { result } = setup(140)
    act(() => result.current.setOffset(1000, -3))
    expect(result.current.transform.offsetX).toBe(140)
    expect(result.current.transform.offsetY).toBe(-3)
  })

  it('re-clamps the offset when the output size shrinks', () => {
    const { result } = setup(1024)
    act(() => result.current.pan(900, 0))
    expect(result.current.transform.offsetX).toBe(900)

    act(() => result.current.setSize(140))
    expect(result.current.size).toBe(140)
    expect(result.current.transform.offsetX).toBe(140)
  })

  it('resets everything but the output size', () => {
    const { result } = setup(512)
    act(() => {
      result.current.pan(20, 20)
      result.current.zoomBy(3)
      result.current.rotate(45)
      result.current.flipX()
    })
    expect(result.current.isDefault()).toBe(false)

    act(() => result.current.reset())
    expect(result.current.isDefault()).toBe(true)
    expect(result.current.size).toBe(512)
  })

  it('ignores an unknown action', () => {
    const { result } = setup()
    const before = result.current.transform
    act(() => result.current.setScale(1)) // no-op value, exercises the path
    expect(result.current.transform).toEqual(before)
  })
})
