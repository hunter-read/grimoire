import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import useArrowKeyNavigation from './useArrowKeyNavigation'

const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))

describe('useArrowKeyNavigation', () => {
  let onNext, onPrev

  beforeEach(() => {
    onNext = vi.fn()
    onPrev = vi.fn()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('advances on ArrowRight and ArrowDown', () => {
    renderHook(() => useArrowKeyNavigation(onNext, onPrev))
    press('ArrowRight')
    press('ArrowDown')
    expect(onNext).toHaveBeenCalledTimes(2)
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('goes back on ArrowLeft and ArrowUp', () => {
    renderHook(() => useArrowKeyNavigation(onNext, onPrev))
    press('ArrowLeft')
    press('ArrowUp')
    expect(onPrev).toHaveBeenCalledTimes(2)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('ignores other keys', () => {
    renderHook(() => useArrowKeyNavigation(onNext, onPrev))
    press('a')
    press('Enter')
    expect(onNext).not.toHaveBeenCalled()
    expect(onPrev).not.toHaveBeenCalled()
  })

  // Typing a tag name into a filter field must not page to the next item.
  it('stays out of the way while focus is in a text input', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    renderHook(() => useArrowKeyNavigation(onNext, onPrev))
    press('ArrowRight')
    expect(onNext).not.toHaveBeenCalled()
  })

  it('stays out of the way while focus is in a textarea', () => {
    const area = document.createElement('textarea')
    document.body.appendChild(area)
    area.focus()
    renderHook(() => useArrowKeyNavigation(onNext, onPrev))
    press('ArrowLeft')
    expect(onPrev).not.toHaveBeenCalled()
  })

  // The callbacks change identity every time the sibling index moves, so a
  // listener bound to a stale closure would navigate from the wrong position.
  it('calls the latest callbacks after a re-render', () => {
    const { rerender } = renderHook(({ next }) => useArrowKeyNavigation(next, onPrev), {
      initialProps: { next: onNext },
    })
    const newer = vi.fn()
    rerender({ next: newer })
    press('ArrowRight')
    expect(onNext).not.toHaveBeenCalled()
    expect(newer).toHaveBeenCalledTimes(1)
  })

  it('unbinds on unmount', () => {
    const { unmount } = renderHook(() => useArrowKeyNavigation(onNext, onPrev))
    unmount()
    press('ArrowRight')
    expect(onNext).not.toHaveBeenCalled()
  })
})
