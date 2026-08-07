import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useResizableWidth from './useResizableWidth'

// A pointer event carrying only the fields the hook reads, plus spies for the
// capture calls jsdom doesn't implement.
function pointerEvent(clientX, { button = 0 } = {}) {
  return {
    clientX,
    button,
    pointerId: 1,
    preventDefault: vi.fn(),
    currentTarget: { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() },
  }
}

// Drive a full drag: press at `from`, move to `to`, release.
function drag(result, from, to) {
  const down = pointerEvent(from)
  act(() => result.current.handleProps.onPointerDown(down))
  act(() => result.current.handleProps.onPointerMove(pointerEvent(to)))
  act(() => result.current.handleProps.onPointerUp(down))
}

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('useResizableWidth', () => {
  it('starts at the initial width', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240 }))
    expect(result.current.width).toBe(240)
  })

  it('widens the pane when the divider is dragged right', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240 }))
    drag(result, 300, 380)
    expect(result.current.width).toBe(320)
  })

  it('narrows the pane when the divider is dragged left', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240 }))
    drag(result, 300, 240)
    expect(result.current.width).toBe(180)
  })

  it('applies the delta from the grab point, so there is no jump on first move', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240 }))
    // Grabbing far from the pane edge still moves by the travelled distance.
    drag(result, 900, 910)
    expect(result.current.width).toBe(250)
  })

  it('clamps to the maximum width', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240, max: 400 }))
    drag(result, 300, 1200)
    expect(result.current.width).toBe(400)
  })

  it('clamps to the minimum width', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240, min: 160 }))
    drag(result, 300, 0)
    expect(result.current.width).toBe(160)
  })

  it('reports the drag state so the divider can highlight itself', () => {
    const { result } = renderHook(() => useResizableWidth('k'))
    expect(result.current.dragging).toBe(false)
    const down = pointerEvent(300)
    act(() => result.current.handleProps.onPointerDown(down))
    expect(result.current.dragging).toBe(true)
    act(() => result.current.handleProps.onPointerUp(down))
    expect(result.current.dragging).toBe(false)
  })

  it('captures the pointer so the drag survives leaving the divider', () => {
    const { result } = renderHook(() => useResizableWidth('k'))
    const down = pointerEvent(300)
    act(() => result.current.handleProps.onPointerDown(down))
    expect(down.currentTarget.setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('ignores a non-primary button so right-click never starts a drag', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240 }))
    act(() => result.current.handleProps.onPointerDown(pointerEvent(300, { button: 2 })))
    expect(result.current.dragging).toBe(false)
    act(() => result.current.handleProps.onPointerMove(pointerEvent(500)))
    expect(result.current.width).toBe(240)
  })

  it('ignores movement when no drag is in progress', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240 }))
    act(() => result.current.handleProps.onPointerMove(pointerEvent(900)))
    expect(result.current.width).toBe(240)
  })

  it('ends the drag when the pointer is cancelled', () => {
    const { result } = renderHook(() => useResizableWidth('k'))
    const down = pointerEvent(300)
    act(() => result.current.handleProps.onPointerDown(down))
    act(() => result.current.handleProps.onPointerCancel(down))
    expect(result.current.dragging).toBe(false)
  })

  it('resizes with the arrow keys so the divider works without a mouse', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240, step: 16 }))
    const press = (key) => {
      const e = { key, preventDefault: vi.fn() }
      act(() => result.current.handleProps.onKeyDown(e))
      return e
    }
    expect(press('ArrowRight').preventDefault).toHaveBeenCalled()
    expect(result.current.width).toBe(256)
    press('ArrowLeft')
    press('ArrowLeft')
    expect(result.current.width).toBe(224)
  })

  it('leaves other keys alone', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240 }))
    const e = { key: 'Enter', preventDefault: vi.fn() }
    act(() => result.current.handleProps.onKeyDown(e))
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(result.current.width).toBe(240)
  })

  it('persists the width for the session and restores it on remount', () => {
    const { result, unmount } = renderHook(() => useResizableWidth('wiki-w', { initial: 240 }))
    drag(result, 300, 400)
    expect(result.current.width).toBe(340)
    unmount()

    const { result: second } = renderHook(() => useResizableWidth('wiki-w', { initial: 240 }))
    expect(second.current.width).toBe(340)
  })

  it('keeps separate widths per key', () => {
    const { result: a } = renderHook(() => useResizableWidth('a', { initial: 240 }))
    drag(a, 300, 400)
    const { result: b } = renderHook(() => useResizableWidth('b', { initial: 240 }))
    expect(b.current.width).toBe(240)
  })

  it('clamps a stored width that falls outside the current limits', () => {
    sessionStorage.setItem('k', JSON.stringify(9999))
    const { result } = renderHook(() => useResizableWidth('k', { max: 520 }))
    expect(result.current.width).toBe(520)
  })

  it('falls back to the initial width when the stored value is not a number', () => {
    sessionStorage.setItem('k', JSON.stringify('wide'))
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240 }))
    expect(result.current.width).toBe(240)
  })

  it('exposes the divider as a labelled separator for assistive tech', () => {
    const { result } = renderHook(() => useResizableWidth('k', { initial: 240, min: 160 }))
    const { handleProps: h } = result.current
    expect(h.role).toBe('separator')
    expect(h['aria-orientation']).toBe('vertical')
    expect(h['aria-valuenow']).toBe(240)
    expect(h['aria-valuemin']).toBe(160)
    expect(h.tabIndex).toBe(0)
  })
})
