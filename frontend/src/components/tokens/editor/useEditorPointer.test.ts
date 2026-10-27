import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, renderHook } from '@testing-library/react'

import useEditorPointer from './useEditorPointer'

/**
 * jsdom's Touch constructor is unreliable across versions, so touch events are
 * fabricated: build a plain Event and attach the `touches` list the handler
 * reads. `preventDefault` is stubbed so assertions can check it was called.
 */
function touchEvent(type, touches) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  event.touches = touches.map(([clientX, clientY]) => ({ clientX, clientY }))
  event.preventDefault = vi.fn()
  return event
}

function wheelEvent({ deltaY = -100, clientX = 0, clientY = 0, shiftKey = false } = {}) {
  const event = new Event('wheel', { bubbles: true, cancelable: true })
  Object.assign(event, { deltaY, clientX, clientY, shiftKey })
  event.preventDefault = vi.fn()
  return event
}

let element
let actions

const RECT = { left: 0, top: 0, width: 256, height: 256 }

beforeEach(() => {
  element = document.createElement('div')
  element.getBoundingClientRect = () => ({ ...RECT, right: 256, bottom: 256 })
  document.body.appendChild(element)

  actions = {
    size: 256,
    scale: 1,
    rotation: 0,
    pan: vi.fn(),
    zoomAt: vi.fn(),
    zoomBy: vi.fn(),
    rotate: vi.fn(),
    setRotation: vi.fn(),
    reset: vi.fn(),
  }
})

const setup = (options) => {
  const ref = { current: element }
  return renderHook(() => useEditorPointer(ref, actions, options))
}

describe('mouse drag', () => {
  it('pans while the button is held, tracking the cursor', () => {
    const { result } = setup()
    act(() =>
      result.current.onMouseDown({ button: 0, clientX: 0, clientY: 0, preventDefault: vi.fn() })
    )
    expect(result.current.isDragging).toBe(true)

    act(() => {
      fireEvent.mouseMove(document, { clientX: 10, clientY: 4 })
    })
    expect(actions.pan).toHaveBeenCalledWith(10, 4)
  })

  it('keeps dragging when the pointer leaves the canvas, and ends on release', () => {
    const { result } = setup()
    act(() =>
      result.current.onMouseDown({ button: 0, clientX: 0, clientY: 0, preventDefault: vi.fn() })
    )

    // A move far outside the element still pans — the listener is on document.
    act(() => {
      fireEvent.mouseMove(document, { clientX: 900, clientY: 900 })
    })
    expect(actions.pan).toHaveBeenCalled()

    act(() => {
      fireEvent.mouseUp(document)
    })
    expect(result.current.isDragging).toBe(false)

    actions.pan.mockClear()
    act(() => {
      fireEvent.mouseMove(document, { clientX: 5, clientY: 5 })
    })
    expect(actions.pan).not.toHaveBeenCalled()
  })

  it('ignores non-primary buttons and the disabled state', () => {
    const { result } = setup()
    act(() =>
      result.current.onMouseDown({ button: 2, clientX: 0, clientY: 0, preventDefault: vi.fn() })
    )
    expect(result.current.isDragging).toBe(false)

    const off = setup({ disabled: true })
    act(() =>
      off.result.current.onMouseDown({ button: 0, clientX: 0, clientY: 0, preventDefault: vi.fn() })
    )
    expect(off.result.current.isDragging).toBe(false)
  })

  it('scales the drag delta when the canvas is displayed larger than its output', () => {
    element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 512 })
    const { result } = setup()
    act(() =>
      result.current.onMouseDown({ button: 0, clientX: 0, clientY: 0, preventDefault: vi.fn() })
    )
    act(() => {
      fireEvent.mouseMove(document, { clientX: 20, clientY: 0 })
    })
    // 20 CSS px across a 512px box on a 256px token = 10 output px.
    expect(actions.pan).toHaveBeenCalledWith(10, 0)
  })
})

describe('wheel', () => {
  it('zooms toward the cursor and prevents the page from scrolling', () => {
    setup()
    const event = wheelEvent({ deltaY: -100, clientX: 168, clientY: 128 })
    act(() => {
      element.dispatchEvent(event)
    })
    expect(event.preventDefault).toHaveBeenCalled()
    // 168 is 40px right of the 128 centre.
    expect(actions.zoomAt).toHaveBeenCalledWith(expect.any(Number), 40, 0)
    expect(actions.zoomAt.mock.calls[0][0]).toBeGreaterThan(1)
  })

  it('zooms out on a downward wheel', () => {
    setup()
    act(() => {
      element.dispatchEvent(wheelEvent({ deltaY: 100 }))
    })
    expect(actions.zoomAt.mock.calls[0][0]).toBeLessThan(1)
  })

  it('rotates instead of zooming when shift is held', () => {
    setup()
    act(() => {
      element.dispatchEvent(wheelEvent({ deltaY: -100, shiftKey: true }))
    })
    expect(actions.rotate).toHaveBeenCalledWith(2)
    expect(actions.zoomAt).not.toHaveBeenCalled()

    act(() => {
      element.dispatchEvent(wheelEvent({ deltaY: 100, shiftKey: true }))
    })
    expect(actions.rotate).toHaveBeenLastCalledWith(-2)
  })

  it('binds nothing while disabled', () => {
    setup({ disabled: true })
    act(() => {
      element.dispatchEvent(wheelEvent())
    })
    expect(actions.zoomAt).not.toHaveBeenCalled()
  })
})

describe('touch', () => {
  it('pans with one finger', () => {
    setup()
    act(() => {
      element.dispatchEvent(touchEvent('touchstart', [[10, 10]]))
      element.dispatchEvent(touchEvent('touchmove', [[18, 14]]))
    })
    expect(actions.pan).toHaveBeenCalledWith(8, 4)
  })

  it('zooms on a pinch', () => {
    setup()
    act(() => {
      element.dispatchEvent(
        touchEvent('touchstart', [
          [100, 128],
          [156, 128],
        ])
      )
      element.dispatchEvent(
        touchEvent('touchmove', [
          [72, 128],
          [184, 128],
        ])
      )
    })
    // Span doubled from 56 to 112, so the target scale doubles.
    expect(actions.zoomAt).toHaveBeenCalled()
    expect(actions.zoomAt.mock.calls[0][0]).toBeCloseTo(2, 5)
  })

  it('ignores incidental twist below the deadzone', () => {
    setup()
    act(() => {
      element.dispatchEvent(
        touchEvent('touchstart', [
          [100, 128],
          [156, 128],
        ])
      )
      // ~2 degrees of rotation — below the 5 degree threshold.
      element.dispatchEvent(
        touchEvent('touchmove', [
          [100, 127],
          [156, 129],
        ])
      )
    })
    expect(actions.setRotation).not.toHaveBeenCalled()
  })

  it('tracks rotation freely once the deadzone is crossed', () => {
    setup()
    act(() => {
      element.dispatchEvent(
        touchEvent('touchstart', [
          [100, 128],
          [156, 128],
        ])
      )
      // ~27 degrees, well past the threshold.
      element.dispatchEvent(
        touchEvent('touchmove', [
          [100, 114],
          [156, 142],
        ])
      )
    })
    expect(actions.setRotation).toHaveBeenCalled()
    expect(actions.setRotation.mock.calls[0][0]).toBeGreaterThan(5)

    // Once twisted, even a small further delta keeps tracking.
    actions.setRotation.mockClear()
    act(() => {
      element.dispatchEvent(
        touchEvent('touchmove', [
          [100, 127],
          [156, 129],
        ])
      )
    })
    expect(actions.setRotation).toHaveBeenCalled()
  })

  it('prevents default on a gesture so the page does not scroll-bounce', () => {
    setup()
    const move = touchEvent('touchmove', [[18, 14]])
    act(() => {
      element.dispatchEvent(touchEvent('touchstart', [[10, 10]]))
      element.dispatchEvent(move)
    })
    expect(move.preventDefault).toHaveBeenCalled()
  })

  it('resumes a one-finger pan when a pinch finger lifts', () => {
    setup()
    act(() => {
      element.dispatchEvent(
        touchEvent('touchstart', [
          [100, 128],
          [156, 128],
        ])
      )
      element.dispatchEvent(touchEvent('touchend', [[100, 128]]))
    })
    actions.pan.mockClear()
    act(() => {
      element.dispatchEvent(touchEvent('touchmove', [[110, 128]]))
    })
    expect(actions.pan).toHaveBeenCalledWith(10, 0)
  })

  it('clears all gesture state when the last finger lifts', () => {
    setup()
    act(() => {
      element.dispatchEvent(touchEvent('touchstart', [[10, 10]]))
      element.dispatchEvent(touchEvent('touchend', []))
    })
    actions.pan.mockClear()
    act(() => {
      element.dispatchEvent(touchEvent('touchmove', [[50, 50]]))
    })
    expect(actions.pan).not.toHaveBeenCalled()
  })
})

describe('keyboard and double click', () => {
  const key = (k, shiftKey = false) => ({ key: k, shiftKey, preventDefault: vi.fn() })

  it('pans with the arrow keys, further with shift', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('ArrowRight')))
    expect(actions.pan).toHaveBeenCalledWith(1, 0)

    act(() => result.current.onKeyDown(key('ArrowUp', true)))
    expect(actions.pan).toHaveBeenLastCalledWith(0, -10)
  })

  it('zooms, rotates, and resets', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('+')))
    expect(actions.zoomBy.mock.calls[0][0]).toBeGreaterThan(1)

    act(() => result.current.onKeyDown(key('-')))
    expect(actions.zoomBy.mock.calls[1][0]).toBeLessThan(1)

    act(() => result.current.onKeyDown(key(']')))
    expect(actions.rotate).toHaveBeenCalledWith(15)

    act(() => result.current.onKeyDown(key('[')))
    expect(actions.rotate).toHaveBeenLastCalledWith(-15)

    act(() => result.current.onKeyDown(key('r')))
    expect(actions.reset).toHaveBeenCalled()
  })

  it('leaves unrelated keys to the browser', () => {
    const { result } = setup()
    const event = key('Tab')
    act(() => result.current.onKeyDown(event))
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(actions.pan).not.toHaveBeenCalled()
  })

  it('ignores keys and double clicks while disabled', () => {
    const { result } = setup({ disabled: true })
    act(() => result.current.onKeyDown(key('ArrowRight')))
    act(() => result.current.onDoubleClick())
    expect(actions.pan).not.toHaveBeenCalled()
    expect(actions.reset).not.toHaveBeenCalled()
  })

  it('resets on double click', () => {
    const { result } = setup()
    act(() => result.current.onDoubleClick())
    expect(actions.reset).toHaveBeenCalled()
  })
})
