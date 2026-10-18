/**
 * Timers a test file leaves running, cleared once the file is done.
 *
 * Components start timers that set state later - a "Saved" badge clearing
 * itself after a couple of seconds, a menu closing after a delay. When one is
 * still pending as its test file finishes, it can fire after Vitest has torn the
 * file's jsdom down: React then reads `window` to schedule the update and throws
 * "window is not defined". Every test passed, but that unhandled error fails the
 * run - the intermittent CI failure, which landed on whichever file happened to
 * be slowest to wind down (OIDCSettingsSection, BookActionsMenu, …).
 *
 * `trackTimers` wraps the global setTimeout/setInterval to remember what each
 * file starts; the returned function cancels whatever is still pending. The
 * test setup calls it after a file's last test, before the environment goes.
 * Timers within a file behave exactly as before.
 */

type Handle = ReturnType<typeof setTimeout>

interface RealTimers {
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
}

// The unwrapped timers, kept on the global so a second call (another file in a
// reused worker) wraps the originals rather than the previous file's wrapper.
const REAL = Symbol.for('grimoire.test.realTimers')

type TimerGlobal = typeof globalThis & { [REAL]?: RealTimers }

export function trackTimers(): () => void {
  const g = globalThis as TimerGlobal
  const real = (g[REAL] ??= {
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    setInterval: g.setInterval,
    clearInterval: g.clearInterval,
  })
  const timeouts = new Set<Handle>()
  const intervals = new Set<Handle>()

  g.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (typeof handler !== 'function') return real.setTimeout(handler, ms, ...args)
    const handle = real.setTimeout(
      (...callArgs: unknown[]) => {
        timeouts.delete(handle)
        handler(...callArgs)
      },
      ms,
      ...args
    )
    timeouts.add(handle)
    return handle
  }) as typeof setTimeout
  g.clearTimeout = ((handle?: Handle) => {
    if (handle !== undefined) timeouts.delete(handle)
    real.clearTimeout(handle)
  }) as typeof clearTimeout
  g.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    const handle = real.setInterval(handler, ms, ...args)
    intervals.add(handle)
    return handle
  }) as typeof setInterval
  g.clearInterval = ((handle?: Handle) => {
    if (handle !== undefined) intervals.delete(handle)
    real.clearInterval(handle)
  }) as typeof clearInterval

  return function clearPending() {
    timeouts.forEach((handle) => real.clearTimeout(handle))
    intervals.forEach((handle) => real.clearInterval(handle))
    timeouts.clear()
    intervals.clear()
  }
}
