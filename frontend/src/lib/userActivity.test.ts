import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_AFTER_MS, isUserActive, onUserReturn } from './userActivity'

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('userActivity', () => {
  let unsubscribe: () => void
  let onReturn: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    onReturn = vi.fn<() => void>()
    unsubscribe = onUserReturn(onReturn)
  })

  afterEach(() => {
    unsubscribe()
    setHidden(false)
    vi.useRealTimers()
  })

  it('counts the tab as active until the idle window passes without input', () => {
    expect(isUserActive()).toBe(true)
    vi.advanceTimersByTime(IDLE_AFTER_MS - 1)
    expect(isUserActive()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isUserActive()).toBe(false)
  })

  it('input keeps the tab active without announcing a return', () => {
    vi.advanceTimersByTime(IDLE_AFTER_MS - 1000)
    window.dispatchEvent(new Event('pointermove'))
    vi.advanceTimersByTime(IDLE_AFTER_MS - 1000)
    expect(isUserActive()).toBe(true)
    expect(onReturn).not.toHaveBeenCalled()
  })

  it('announces a return on the first input after going idle', () => {
    vi.advanceTimersByTime(IDLE_AFTER_MS)
    window.dispatchEvent(new Event('keydown'))
    expect(isUserActive()).toBe(true)
    expect(onReturn).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('keydown'))
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('a hidden tab is inactive, and showing it again is a return', () => {
    setHidden(true)
    expect(isUserActive()).toBe(false)
    expect(onReturn).not.toHaveBeenCalled()
    setHidden(false)
    expect(isUserActive()).toBe(true)
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('input in a hidden tab does not announce a return', () => {
    setHidden(true)
    window.dispatchEvent(new Event('keydown'))
    expect(onReturn).not.toHaveBeenCalled()
  })

  it('stops listening once the last subscriber leaves', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const other = onUserReturn(() => {})
    unsubscribe()
    expect(remove).not.toHaveBeenCalled()
    other()
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true })
    vi.advanceTimersByTime(IDLE_AFTER_MS)
    window.dispatchEvent(new Event('keydown'))
    expect(onReturn).not.toHaveBeenCalled()
    remove.mockRestore()
  })
})
