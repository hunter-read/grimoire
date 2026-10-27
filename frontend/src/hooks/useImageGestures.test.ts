import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useImageGestures from './useImageGestures'

// jsdom has no TouchEvent, so dispatch plain events carrying the touch arrays
// the handlers actually read.
const touchEvent = (type, touches, changedTouches = touches) => {
  const e = new Event(type, { bubbles: true, cancelable: true })
  e.touches = touches
  e.changedTouches = changedTouches
  return e
}
const at = (x, y) => ({ clientX: x, clientY: y })

describe('useImageGestures', () => {
  let el, containerRef, onNext, onPrev

  const setup = (resetKey = 'a') =>
    renderHook((props) => useImageGestures({ onNext, onPrev, containerRef, resetKey, ...props }))

  const fire = (type, touches, changed) =>
    act(() => {
      el.dispatchEvent(touchEvent(type, touches, changed))
    })

  beforeEach(() => {
    el = document.createElement('div')
    document.body.appendChild(el)
    containerRef = { current: el }
    onNext = vi.fn()
    onPrev = vi.fn()
  })

  it('starts unzoomed, with a style that allows vertical scrolling', () => {
    const { result } = setup()
    expect(result.current.zoom).toBe(1)
    expect(result.current.imageStyle.transform).toBe('none')
    expect(result.current.imageStyle.touchAction).toBe('pan-y')
  })

  describe('swipe', () => {
    it('advances on a left swipe past the threshold', () => {
      setup()
      fire('touchstart', [at(200, 100)])
      fire('touchend', [], [at(100, 105)])
      expect(onNext).toHaveBeenCalledTimes(1)
      expect(onPrev).not.toHaveBeenCalled()
    })

    it('goes back on a right swipe past the threshold', () => {
      setup()
      fire('touchstart', [at(100, 100)])
      fire('touchend', [], [at(220, 90)])
      expect(onPrev).toHaveBeenCalledTimes(1)
    })

    it('ignores a swipe too short to be deliberate', () => {
      setup()
      fire('touchstart', [at(100, 100)])
      fire('touchend', [], [at(130, 100)])
      expect(onNext).not.toHaveBeenCalled()
      expect(onPrev).not.toHaveBeenCalled()
    })

    // A mostly-vertical drag is the user scrolling the page, not paging.
    it('ignores a drag that is mostly vertical', () => {
      setup()
      fire('touchstart', [at(100, 100)])
      fire('touchend', [], [at(40, 300)])
      expect(onNext).not.toHaveBeenCalled()
      expect(onPrev).not.toHaveBeenCalled()
    })
  })

  describe('pinch to zoom', () => {
    it('scales with the distance between two fingers', () => {
      const { result } = setup()
      fire('touchstart', [at(100, 100), at(200, 100)])
      fire('touchmove', [at(50, 100), at(250, 100)])
      expect(result.current.zoom).toBeCloseTo(2, 5)
      expect(result.current.imageStyle.transform).toContain('scale(2)')
      // Zoomed in, the image takes over touch handling so panning works.
      expect(result.current.imageStyle.touchAction).toBe('none')
    })

    it('clamps zoom to 5x', () => {
      const { result } = setup()
      fire('touchstart', [at(100, 100), at(200, 100)])
      fire('touchmove', [at(0, 100), at(1000, 100)])
      expect(result.current.zoom).toBe(5)
    })

    it('never zooms below 1x', () => {
      const { result } = setup()
      fire('touchstart', [at(0, 100), at(400, 100)])
      fire('touchmove', [at(190, 100), at(210, 100)])
      expect(result.current.zoom).toBe(1)
    })

    // Releasing a barely-there pinch snaps back rather than leaving the image
    // fractionally zoomed and unable to scroll.
    it('snaps back on release when the pinch barely moved', () => {
      const { result } = setup()
      fire('touchstart', [at(100, 100), at(200, 100)])
      fire('touchmove', [at(98, 100), at(212, 100)])
      expect(result.current.zoom).toBeGreaterThan(1)
      fire('touchend', [], [at(98, 100)])
      expect(result.current.zoom).toBe(1)
    })

    it('keeps a deliberate zoom on release', () => {
      const { result } = setup()
      fire('touchstart', [at(100, 100), at(200, 100)])
      fire('touchmove', [at(50, 100), at(250, 100)])
      fire('touchend', [], [at(50, 100)])
      expect(result.current.zoom).toBeCloseTo(2, 5)
    })

    it('does not page when a pinch ends', () => {
      setup()
      fire('touchstart', [at(100, 100), at(200, 100)])
      fire('touchmove', [at(50, 100), at(250, 100)])
      fire('touchend', [], [at(400, 100)])
      expect(onNext).not.toHaveBeenCalled()
      expect(onPrev).not.toHaveBeenCalled()
    })
  })

  describe('pan when zoomed', () => {
    const zoomIn = () => {
      fire('touchstart', [at(100, 100), at(200, 100)])
      fire('touchmove', [at(50, 100), at(250, 100)])
      fire('touchend', [], [at(50, 100)])
    }

    it('moves the image with one finger once zoomed', () => {
      const { result } = setup()
      zoomIn()
      fire('touchstart', [at(100, 100)])
      fire('touchmove', [at(140, 160)])
      // Offsets are divided by the zoom factor so panning tracks the finger.
      expect(result.current.imageStyle.transform).toContain('translate(20px, 30px)')
    })

    it('does not page at the end of a pan', () => {
      setup()
      zoomIn()
      fire('touchstart', [at(300, 100)])
      fire('touchmove', [at(100, 100)])
      fire('touchend', [], [at(100, 100)])
      expect(onNext).not.toHaveBeenCalled()
    })
  })

  it('resets zoom and pan when the item changes', () => {
    const { result, rerender } = setup('a')
    fire('touchstart', [at(100, 100), at(200, 100)])
    fire('touchmove', [at(50, 100), at(250, 100)])
    expect(result.current.zoom).toBeCloseTo(2, 5)
    rerender({ resetKey: 'b' })
    expect(result.current.zoom).toBe(1)
    expect(result.current.imageStyle.transform).toBe('none')
  })

  it('navigates with the arrow keys', () => {
    setup()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a container to bind to', () => {
    containerRef = { current: null }
    expect(() => setup()).not.toThrow()
  })
})
