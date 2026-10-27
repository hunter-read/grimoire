import { describe, it, expect } from 'vitest'
import { createWheelGesture } from './wheelGesture'

/** Feed magnitudes 16 ms apart (one per frame) and count the gestures started. */
function run(magnitudes, { tracker = createWheelGesture(), start = 0, every = 16 } = {}) {
  let starts = 0
  magnitudes.forEach((m, i) => {
    if (tracker(m, start + i * every)) starts++
  })
  return starts
}

// A swipe: fingers ramp up, then momentum decays through a long tail of 1s.
const ramp = [3, 8, 20, 45, 70]
const momentum = [60, 48, 38, 30, 24, 19, 15, 12, 9, 7, 5, 4, 3, 2, 2, 1, 1, 1, 1, 1]
const swipe = [...ramp, ...momentum]

describe('createWheelGesture', () => {
  it('treats the first event as a new gesture', () => {
    expect(createWheelGesture()(10, 0)).toBe(true)
  })

  it('counts a swipe and its whole momentum tail as one gesture', () => {
    expect(run(swipe)).toBe(1)
  })

  it('starts a new gesture after a quiet gap', () => {
    const tracker = createWheelGesture()
    run(swipe, { tracker })
    expect(tracker(3, swipe.length * 16 + 300)).toBe(true)
  })

  it('catches a fresh swipe made while the last one is still coasting (issue #485)', () => {
    // No gap at all: the second swipe's ramp lands straight on the first's tail.
    // Waiting for quiet alone swallowed every swipe until the user stopped.
    expect(run([...swipe, ...swipe])).toBe(2)
  })

  it('catches a fresh swipe that cuts the momentum short', () => {
    // Touching the trackpad stops the coast, so the deltas drop and then climb.
    expect(run([...ramp, 60, 48, 38, 30, 24, 2, 6, 15, 30, 55, 70])).toBe(2)
  })

  it('does not mistake one coalesced event in the tail for a new swipe', () => {
    // The browser can merge two frames' deltas into one event, doubling it.
    expect(run([...ramp, 60, 40, 25, 15, 8, 4, 4, 8, 4, 4, 4, 3, 2, 4, 2, 1])).toBe(1)
  })

  it('ignores jitter too small to be deliberate in a nearly still tail', () => {
    expect(run([...ramp, 50, 30, 15, 6, 2, 1, 1, 1, 2, 3, 3, 2, 1])).toBe(1)
  })

  it('does not split a steady run, like a spun mouse wheel', () => {
    expect(run(Array(20).fill(100))).toBe(1)
  })

  it('does not split a swipe while the fingers are still speeding up', () => {
    expect(run([2, 3, 2, 5, 9, 14, 30, 60, 90])).toBe(1)
  })
})
