import { trackTimers } from './pendingTimers'

// setup.ts already tracks this file's timers; these tests take their own
// tracker, which wraps the same untouched originals.
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('trackTimers', () => {
  it('cancels a timeout that is still pending', async () => {
    const clearPending = trackTimers()
    const fired = vi.fn()
    setTimeout(fired, 20)
    clearPending()
    await wait(60)
    expect(fired).not.toHaveBeenCalled()
  })

  it('cancels a running interval', async () => {
    const clearPending = trackTimers()
    const ticked = vi.fn()
    setInterval(ticked, 10)
    await wait(35)
    clearPending()
    const ticks = ticked.mock.calls.length
    expect(ticks).toBeGreaterThan(0)
    await wait(40)
    expect(ticked).toHaveBeenCalledTimes(ticks)
  })

  it('leaves timers that already fired, or were cleared, alone', async () => {
    const clearPending = trackTimers()
    const fired = vi.fn()
    setTimeout(fired, 5, 'arg')
    const cancelled = vi.fn()
    clearTimeout(setTimeout(cancelled, 5))
    await wait(30)
    clearPending()
    expect(fired).toHaveBeenCalledWith('arg')
    expect(cancelled).not.toHaveBeenCalled()
  })

  it('wraps the original timers, not an earlier wrapper', async () => {
    const first = trackTimers()
    const second = trackTimers()
    const fired = vi.fn()
    setTimeout(fired, 20)
    // Only the latest tracker saw the timer: had it wrapped the first tracker's
    // wrapper, clearing the first would cancel it too.
    first()
    await wait(60)
    expect(fired).toHaveBeenCalledTimes(1)
    second()
  })
})
