import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useReaderZoom, {
  renderWidthFor,
  clampZoom,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  ZOOM_LEVELS,
  MAX_RENDER_WIDTH,
  nextZoomLevel,
  prevZoomLevel,
  panForTurn,
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

  it('leaves spread pages room to sharpen fully at 2x', () => {
    expect(renderWidthFor(1000, 2)).toBe(2000)
    // Past the cap the whole-page image stops growing; zoom tiles take over.
    expect(renderWidthFor(1000, MAX_ZOOM)).toBe(MAX_RENDER_WIDTH)
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

describe('zoom levels (issue #574)', () => {
  it('reach 8x', () => {
    expect(MAX_ZOOM).toBe(8)
    expect(ZOOM_LEVELS.at(-1)).toBe(MAX_ZOOM)
  })

  it('step to the next stop either way', () => {
    expect(nextZoomLevel(1)).toBe(1.25)
    expect(nextZoomLevel(2)).toBe(2.5)
    expect(prevZoomLevel(4)).toBe(3)
    expect(prevZoomLevel(1.25)).toBe(1)
  })

  it('treat a wheel or pinch zoom between stops as the stop it passed', () => {
    expect(nextZoomLevel(2.2)).toBe(2.5)
    expect(prevZoomLevel(2.2)).toBe(2)
    // A float a hair under a stop still counts as that stop.
    expect(nextZoomLevel(1.2499999)).toBe(1.5)
  })

  it('stay inside the range at the ends', () => {
    expect(nextZoomLevel(MAX_ZOOM)).toBe(MAX_ZOOM)
    expect(prevZoomLevel(MIN_ZOOM)).toBe(MIN_ZOOM)
  })

  it('drive zoomIn and zoomOut', () => {
    const { result } = renderHook(() => useReaderZoom())
    for (let i = 0; i < ZOOM_LEVELS.length + 2; i++) act(() => result.current.zoomIn())
    expect(result.current.zoom).toBe(MAX_ZOOM)
    expect(result.current.canZoomIn).toBe(false)
    act(() => result.current.zoomOut())
    expect(result.current.zoom).toBe(6)
  })
})

describe('panForTurn', () => {
  // A page 2000px tall on screen at 2x, in an 800px view, scrolled to the middle.
  const base = { zoom: 2, pan: { x: 30, y: 0 }, top: -1000, bottom: 1000, viewHeight: 800 }

  it('lands at the top of the next page, keeping the column', () => {
    const next = panForTurn({ ...base, direction: 1, margin: 0 })
    expect(next.x).toBe(30)
    // The page top (pre-scale -500) meets the view top (pre-scale -200).
    expect(-500 + next.y).toBeCloseTo(-200)
  })

  it('lands at the bottom when going back', () => {
    const next = panForTurn({ ...base, direction: -1, margin: 0 })
    expect(500 + next.y).toBeCloseTo(200)
  })

  it('leaves a small margin above the page', () => {
    const next = panForTurn({ ...base, direction: 1, margin: 12 })
    // 12 screen pixels is 6 pre-scale pixels at 2x.
    expect(-500 + next.y).toBeCloseTo(-194)
  })

  it('accounts for the pan already applied', () => {
    const panned = { ...base, pan: { x: 0, y: 100 }, top: -800, bottom: 1200 }
    const next = panForTurn({ ...panned, direction: 1, margin: 0 })
    expect(next.y).toBeCloseTo(panForTurn({ ...base, direction: 1, margin: 0 }).y)
  })

  it('centres a page that fits on screen', () => {
    const next = panForTurn({ ...base, top: -300, bottom: 300, direction: 1 })
    expect(next).toEqual({ x: 30, y: 0 })
  })
})
