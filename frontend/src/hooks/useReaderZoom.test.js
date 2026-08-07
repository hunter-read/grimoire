import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useReaderZoom, {
  renderWidthFor,
  clampZoom,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  MAX_RENDER_WIDTH,
} from './useReaderZoom'

describe('clampZoom', () => {
  it('holds the zoom inside the supported range', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(1.5)).toBe(1.5)
  })
})

describe('renderWidthFor', () => {
  it('keeps the base width while the base render is still sharp', () => {
    expect(renderWidthFor(1600, 1)).toBe(1600)
    expect(renderWidthFor(1600, 1.5)).toBe(1600)
  })

  it('requests a higher render width past the threshold', () => {
    expect(renderWidthFor(1600, 1.75)).toBe(2800)
  })

  it('never exceeds the width the server accepts', () => {
    // 1600 * 2 = 3200, above the endpoint's le=3000 cap.
    expect(renderWidthFor(1600, MAX_ZOOM)).toBe(MAX_RENDER_WIDTH)
  })

  it('quantises to zoom steps so panning does not churn the cache', () => {
    // Any zoom within the same step maps to one cached width per page.
    expect(renderWidthFor(1000, 1.76)).toBe(renderWidthFor(1000, 1.74))
  })

  it('leaves spread pages room to sharpen fully', () => {
    expect(renderWidthFor(1000, MAX_ZOOM)).toBe(2000)
  })
})

describe('useReaderZoom', () => {
  it('starts unzoomed and un-panned', () => {
    const { result } = renderHook(() => useReaderZoom({}))
    expect(result.current.zoom).toBe(MIN_ZOOM)
    expect(result.current.pan).toEqual({ x: 0, y: 0 })
    expect(result.current.isZoomed).toBe(false)
    expect(result.current.canZoomOut).toBe(false)
  })

  it('steps in and out by one increment', () => {
    const { result } = renderHook(() => useReaderZoom({}))
    act(() => result.current.zoomIn())
    expect(result.current.zoom).toBeCloseTo(MIN_ZOOM + ZOOM_STEP)
    act(() => result.current.zoomOut())
    expect(result.current.zoom).toBeCloseTo(MIN_ZOOM)
  })

  it('clamps at both ends', () => {
    const { result } = renderHook(() => useReaderZoom({}))
    act(() => result.current.zoomOut())
    expect(result.current.zoom).toBe(MIN_ZOOM)
    for (let i = 0; i < 20; i++) act(() => result.current.zoomIn())
    expect(result.current.zoom).toBe(MAX_ZOOM)
    expect(result.current.canZoomIn).toBe(false)
  })

  it('keeps the anchored point visually fixed when zooming at a cursor', () => {
    const { result } = renderHook(() => useReaderZoom({}))
    // The transform is scale(z) translate(pan), so a point at pre-scale offset u
    // sits at screen offset z * (u + pan).
    const cursor = 200
    const before = MIN_ZOOM * (cursor / MIN_ZOOM - 0)
    act(() => result.current.zoomAt(1, cursor, 0))
    const u = cursor / MIN_ZOOM - 0
    const after = result.current.zoom * (u + result.current.pan.x)
    expect(after).toBeCloseTo(before)
  })

  it('zooms about the centre when no origin is given', () => {
    const { result } = renderHook(() => useReaderZoom({}))
    act(() => result.current.zoomIn())
    expect(result.current.pan).toEqual({ x: 0, y: 0 })
  })

  it('clears pan when returning to 1x', () => {
    const { result } = renderHook(() => useReaderZoom({}))
    act(() => result.current.zoomAt(1, 300, 120))
    expect(result.current.pan).not.toEqual({ x: 0, y: 0 })
    act(() => result.current.resetZoom())
    expect(result.current.zoom).toBe(MIN_ZOOM)
    expect(result.current.pan).toEqual({ x: 0, y: 0 })
  })

  it('resets zoom and pan when the reset key changes', () => {
    const { result, rerender } = renderHook(({ k }) => useReaderZoom({ resetKey: k }), {
      initialProps: { k: 1 },
    })
    act(() => result.current.zoomAt(1, 100, 50))
    expect(result.current.isZoomed).toBe(true)

    rerender({ k: 2 }) // turned the page
    expect(result.current.zoom).toBe(MIN_ZOOM)
    expect(result.current.pan).toEqual({ x: 0, y: 0 })
  })

  it('supports functional pan updates for drag-to-pan', () => {
    const { result } = renderHook(() => useReaderZoom({}))
    act(() => result.current.zoomIn())
    act(() => result.current.setPan((p) => ({ x: p.x + 10, y: p.y - 5 })))
    expect(result.current.pan).toEqual({ x: 10, y: -5 })
  })
})
