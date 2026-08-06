import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createRef } from 'react'
import useReaderGestures from './useReaderGestures'

/** Mount the hook against a real element so the native wheel listener binds. */
function setup(overrides = {}) {
  const el = document.createElement('div')
  // jsdom gives zero-size rects; fake one so cursor-anchor maths has a centre.
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 })
  document.body.appendChild(el)
  const contentRef = createRef()
  contentRef.current = el

  const zoomRef = { current: overrides.zoom ?? 1 }
  const panRef = { current: { x: 0, y: 0 } }
  const opts = {
    mode: 'page',
    currentPage: 5,
    zoom: overrides.zoom ?? 1,
    pan: { x: 0, y: 0 },
    zoomRef,
    panRef,
    setPan: vi.fn(),
    setZoomDirect: vi.fn(),
    zoomAt: vi.fn(),
    goToPage: vi.fn(),
    contentRef,
    wheelAction: 'page',
    ...overrides,
  }
  const view = renderHook(() => useReaderGestures(opts))
  const wheel = (init = {}) => {
    const e = new WheelEvent('wheel', { deltaY: 100, cancelable: true, ...init })
    el.dispatchEvent(e)
    return e
  }
  return { ...view, el, wheel, opts }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('useReaderGestures — wheel', () => {
  it('turns pages when the action is "page"', () => {
    const { wheel, opts } = setup({ wheelAction: 'page' })
    wheel({ deltaY: 100 })
    expect(opts.goToPage).toHaveBeenCalledWith(6, undefined, 'y')
    expect(opts.zoomAt).not.toHaveBeenCalled()
  })

  it('zooms instead of paging when the action is "zoom"', () => {
    const { wheel, opts } = setup({ wheelAction: 'zoom' })
    wheel({ deltaY: -100 })
    expect(opts.zoomAt).toHaveBeenCalled()
    expect(opts.goToPage).not.toHaveBeenCalled()
    // Scrolling up (negative deltaY) zooms in.
    expect(opts.zoomAt.mock.calls[0][0]).toBeGreaterThan(0)
  })

  it('does nothing when the action is "none"', () => {
    const { wheel, opts } = setup({ wheelAction: 'none' })
    const e = wheel({ deltaY: 100 })
    expect(opts.goToPage).not.toHaveBeenCalled()
    expect(opts.zoomAt).not.toHaveBeenCalled()
    // Left un-prevented so the container can scroll normally.
    expect(e.defaultPrevented).toBe(false)
  })

  it.each([['page'], ['none'], ['zoom']])(
    'ctrl+wheel always zooms, whatever the "%s" preference is',
    (wheelAction) => {
      const { wheel, opts } = setup({ wheelAction })
      wheel({ deltaY: -100, ctrlKey: true })
      expect(opts.zoomAt).toHaveBeenCalled()
      expect(opts.goToPage).not.toHaveBeenCalled()
    }
  )

  it('treats cmd+wheel the same as ctrl+wheel', () => {
    const { wheel, opts } = setup({ wheelAction: 'page' })
    wheel({ deltaY: -100, metaKey: true })
    expect(opts.zoomAt).toHaveBeenCalled()
    expect(opts.goToPage).not.toHaveBeenCalled()
  })

  it('anchors the zoom at the cursor rather than the element centre', () => {
    const { wheel, opts } = setup({ wheelAction: 'zoom' })
    // Element is 800x600 at the origin, so its centre is (400, 300).
    wheel({ deltaY: -100, clientX: 600, clientY: 450 })
    const [, originX, originY] = opts.zoomAt.mock.calls[0]
    expect(originX).toBe(200)
    expect(originY).toBe(150)
  })

  it('is not throttled while zooming, unlike paging', () => {
    const { wheel, opts } = setup({ wheelAction: 'zoom' })
    wheel({ deltaY: -100 })
    wheel({ deltaY: -100 })
    wheel({ deltaY: -100 })
    // Throttling zoom drops frames and makes it feel broken.
    expect(opts.zoomAt).toHaveBeenCalledTimes(3)
  })

  it('still throttles paging so one flick does not skip several pages', () => {
    const { wheel, opts } = setup({ wheelAction: 'page' })
    wheel({ deltaY: 100 })
    wheel({ deltaY: 100 })
    wheel({ deltaY: 100 })
    expect(opts.goToPage).toHaveBeenCalledTimes(1)
  })

  it('caps how far one wheel event can zoom', () => {
    const { wheel, opts } = setup({ wheelAction: 'zoom' })
    wheel({ deltaY: -100000 })
    expect(Math.abs(opts.zoomAt.mock.calls[0][0])).toBeLessThanOrEqual(0.15)
  })

  it('lets a zoomed page scroll instead of paging when the wheel means "page"', () => {
    // Previously a zoom > 1 swallowed the wheel entirely, so a zoomed page could
    // neither be scrolled nor zoomed back out.
    const { wheel, opts } = setup({ wheelAction: 'page', zoom: 1.5 })
    const e = wheel({ deltaY: 100 })
    expect(opts.goToPage).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it('can still zoom back out from a zoomed page', () => {
    const { wheel, opts } = setup({ wheelAction: 'zoom', zoom: 1.5 })
    wheel({ deltaY: 100 })
    expect(opts.zoomAt).toHaveBeenCalled()
    expect(opts.zoomAt.mock.calls[0][0]).toBeLessThan(0)
  })

  it('ignores the wheel entirely in pdf mode', () => {
    const { wheel, opts } = setup({ mode: 'pdf', wheelAction: 'zoom' })
    wheel({ deltaY: -100 })
    expect(opts.zoomAt).not.toHaveBeenCalled()
    expect(opts.goToPage).not.toHaveBeenCalled()
  })

  it('pages by two at a time in spread mode', () => {
    const { wheel, opts } = setup({ mode: 'spread', wheelAction: 'page' })
    wheel({ deltaY: 100 })
    expect(opts.goToPage).toHaveBeenCalledWith(7, undefined, 'y')
  })
})

describe('useReaderGestures — mouse pan', () => {
  const mouseDown = (extra = {}) => ({
    button: 0,
    clientX: 100,
    clientY: 100,
    preventDefault: vi.fn(),
    target: { closest: () => null },
    ...extra,
  })

  it('pans while dragging a zoomed page', () => {
    const { result, opts } = setup({ zoom: 2 })
    result.current.handleMouseDown(mouseDown())
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 120 }))
    // Pan is stored pre-scale, so the drag distance is divided by the zoom.
    expect(opts.setPan).toHaveBeenCalledWith({ x: 20, y: 10 })
  })

  it('does nothing at 1x, where there is nothing to pan to', () => {
    const { result, opts } = setup({ zoom: 1 })
    result.current.handleMouseDown(mouseDown())
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 120 }))
    expect(opts.setPan).not.toHaveBeenCalled()
  })

  it('leaves selectable page text to the browser', () => {
    const { result, opts } = setup({ zoom: 2 })
    result.current.handleMouseDown(mouseDown({ target: { closest: () => ({}) } }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 120 }))
    expect(opts.setPan).not.toHaveBeenCalled()
  })

  it('stops panning once the button is released', () => {
    const { result, opts } = setup({ zoom: 2 })
    result.current.handleMouseDown(mouseDown())
    window.dispatchEvent(new MouseEvent('mouseup'))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 300 }))
    expect(opts.setPan).not.toHaveBeenCalled()
  })
})

describe('useReaderGestures — touch', () => {
  const touch = (x, y) => ({ clientX: x, clientY: y })
  const touchEvent = (touches, changed = touches) => ({
    touches,
    changedTouches: changed,
    preventDefault: vi.fn(),
  })

  it('pinches to zoom, clamped to the supported range', () => {
    const { result, opts } = setup()
    result.current.handleTouchStart(touchEvent([touch(0, 0), touch(100, 0)]))
    // Fingers move twice as far apart -> 2x.
    result.current.handleTouchMove(touchEvent([touch(0, 0), touch(200, 0)]))
    expect(opts.setZoomDirect).toHaveBeenCalledWith(2)

    // Spreading further is held at the ceiling rather than softening the image.
    result.current.handleTouchMove(touchEvent([touch(0, 0), touch(900, 0)]))
    expect(opts.setZoomDirect).toHaveBeenLastCalledWith(2)
  })

  it('snaps back to 1x when a pinch ends barely zoomed', () => {
    const { result, opts } = setup({ zoom: 1.1 })
    result.current.handleTouchStart(touchEvent([touch(0, 0), touch(100, 0)]))
    opts.zoomRef.current = 1.1
    result.current.handleTouchEnd(touchEvent([], [touch(0, 0)]))
    expect(opts.setZoomDirect).toHaveBeenCalledWith(1)
  })

  it('keeps a deliberate pinch instead of snapping back', () => {
    const { result, opts } = setup({ zoom: 1.8 })
    result.current.handleTouchStart(touchEvent([touch(0, 0), touch(100, 0)]))
    opts.zoomRef.current = 1.8
    result.current.handleTouchEnd(touchEvent([], [touch(0, 0)]))
    expect(opts.setZoomDirect).not.toHaveBeenCalled()
  })

  it('one finger pans while zoomed', () => {
    const { result, opts } = setup({ zoom: 2 })
    result.current.handleTouchStart(touchEvent([touch(100, 100)]))
    result.current.handleTouchMove(touchEvent([touch(140, 120)]))
    // Divided by the zoom, since pan is stored pre-scale.
    expect(opts.setPan).toHaveBeenCalledWith({ x: 20, y: 10 })
  })

  it('one finger swipes to the next page when not zoomed', () => {
    const { result, opts } = setup({ zoom: 1 })
    result.current.handleTouchStart(touchEvent([touch(300, 100)]))
    result.current.handleTouchEnd(touchEvent([], [touch(200, 100)]))
    expect(opts.goToPage).toHaveBeenCalledWith(6, undefined, 'x')
  })

  it('swipes back to the previous page in the other direction', () => {
    const { result, opts } = setup({ zoom: 1 })
    result.current.handleTouchStart(touchEvent([touch(100, 100)]))
    result.current.handleTouchEnd(touchEvent([], [touch(300, 100)]))
    expect(opts.goToPage).toHaveBeenCalledWith(4, undefined, 'x')
  })

  it('ignores a swipe too short to be deliberate', () => {
    const { result, opts } = setup({ zoom: 1 })
    result.current.handleTouchStart(touchEvent([touch(100, 100)]))
    result.current.handleTouchEnd(touchEvent([], [touch(120, 100)]))
    expect(opts.goToPage).not.toHaveBeenCalled()
  })

  it('does not swipe after panning a zoomed page', () => {
    const { result, opts } = setup({ zoom: 2 })
    result.current.handleTouchStart(touchEvent([touch(300, 100)]))
    result.current.handleTouchEnd(touchEvent([], [touch(100, 100)]))
    expect(opts.goToPage).not.toHaveBeenCalled()
  })

  it('ignores touches entirely in pdf mode', () => {
    const { result, opts } = setup({ mode: 'pdf' })
    result.current.handleTouchStart(touchEvent([touch(300, 100)]))
    result.current.handleTouchEnd(touchEvent([], [touch(100, 100)]))
    expect(opts.goToPage).not.toHaveBeenCalled()
    expect(opts.setZoomDirect).not.toHaveBeenCalled()
  })
})
