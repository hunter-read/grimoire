// Splits a stream of wheel events into gestures, so the reader can turn one page
// per swipe (issue #485).
//
// A trackpad swipe keeps firing wheel events through its momentum for a second
// or more after the fingers lift, so neither "one turn per N ms" nor "wait for
// the events to stop" works on its own: the first lets the momentum tail turn a
// second page, the second swallows a fresh swipe made before the momentum dies.
// A gesture therefore starts either after a quiet gap, or when a fading gesture
// speeds up again - momentum only ever slows down, so a rise is new fingers.

// Quiet time that ends a gesture outright.
const GESTURE_GAP = 250
// A gesture is fading once its delta drops below this share of its peak: the
// fingers have lifted and only momentum is left.
const FADE_RATIO = 0.5
// Events per side of the before/after comparison. Averaging several rides out a
// single event the browser coalesced from two, which would otherwise look like a
// doubling.
const WINDOW = 3
// A fading gesture that speeds up by this much is a new swipe...
const RISE_RATIO = 1.5
// ...as long as the rise is big enough to be deliberate, so jitter in a nearly
// still momentum tail can't turn a page.
const MIN_RISE = 6

const average = (values) => values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * Make a gesture tracker for one wheel target.
 *
 * @returns {(magnitude: number, now: number) => boolean} Call once per wheel
 *   event with its larger absolute delta and a timestamp in ms; returns true when
 *   the event starts a new gesture.
 */
export function createWheelGesture() {
  let lastAt = -Infinity
  let peak = 0
  let fading = false
  let recent = []

  const isRising = () => {
    if (recent.length < WINDOW * 2) return false
    const before = average(recent.slice(0, WINDOW))
    const after = average(recent.slice(WINDOW))
    return after >= MIN_RISE && after > before * RISE_RATIO
  }

  return function isNewGesture(magnitude, now) {
    const quiet = now - lastAt >= GESTURE_GAP
    lastAt = now
    recent.push(magnitude)
    if (recent.length > WINDOW * 2) recent.shift()

    if (quiet || (fading && isRising())) {
      peak = magnitude
      fading = false
      recent = [magnitude]
      return true
    }
    peak = Math.max(peak, magnitude)
    if (magnitude < peak * FADE_RATIO) fading = true
    return false
  }
}
