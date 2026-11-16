/**
 * Whether somebody is actually using this tab.
 *
 * Background polling is only worth its requests while someone can see the
 * answer. A tab left open overnight otherwise keeps asking the server the same
 * question for hours, which keeps a small home server from ever going quiet.
 * So polling (see `useIdleAwareInterval`) stops when the tab is hidden, or when
 * nothing has been pressed, moved, or scrolled for `IDLE_AFTER_MS`, and picks
 * up again the moment the user comes back.
 */

/** How long without any input before the tab counts as unattended. */
export const IDLE_AFTER_MS = 5 * 60 * 1000

// Input of any kind. Each only stamps the time, so listening to the frequent
// ones (pointermove, wheel) costs nothing worth measuring.
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

let lastInput = Date.now()
let attached = false
const returnListeners = new Set<() => void>()

/** True while the tab is visible and has seen input within `IDLE_AFTER_MS`. */
export function isUserActive(): boolean {
  return !document.hidden && Date.now() - lastInput < IDLE_AFTER_MS
}

function noteInput(): void {
  const wasActive = isUserActive()
  lastInput = Date.now()
  if (!wasActive && !document.hidden) returnListeners.forEach((fn) => fn())
}

function onVisibilityChange(): void {
  // Switching back to the tab is the user turning up, however briefly it was
  // hidden: whatever was polled may have changed meanwhile.
  if (document.hidden) return
  lastInput = Date.now()
  returnListeners.forEach((fn) => fn())
}

function attach(): void {
  if (attached) return
  attached = true
  lastInput = Date.now()
  for (const name of INPUT_EVENTS) {
    window.addEventListener(name, noteInput, { passive: true, capture: true })
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
}

function detach(): void {
  attached = false
  for (const name of INPUT_EVENTS) {
    window.removeEventListener(name, noteInput, { capture: true })
  }
  document.removeEventListener('visibilitychange', onVisibilityChange)
}

/**
 * Call `fn` when the user comes back after the tab went unattended. Returns the
 * unsubscribe function. Input is only listened for while someone is subscribed.
 */
export function onUserReturn(fn: () => void): () => void {
  attach()
  returnListeners.add(fn)
  return () => {
    returnListeners.delete(fn)
    if (returnListeners.size === 0) detach()
  }
}

/**
 * `setInterval` for background polling: runs `callback` every `ms` only while
 * someone is using the tab. Returns the function that stops it.
 *
 * Once the tab is unattended the timer is cleared outright - no requests, no
 * wake-ups - and when the user comes back `callback` runs straight away, so
 * what they see is current, and the timer starts again.
 */
export function startIdleAwareInterval(callback: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    clearInterval(id)
    id = undefined
  }
  const start = () => {
    if (id !== undefined) return
    id = setInterval(() => {
      if (isUserActive()) callback()
      else stop()
    }, ms)
  }

  start()
  const unsubscribe = onUserReturn(() => {
    callback()
    start()
  })
  return () => {
    stop()
    unsubscribe()
  }
}
