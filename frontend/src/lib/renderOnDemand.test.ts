import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderLoop } from './renderOnDemand'

describe('createRenderLoop', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextId: number

  /** Run every frame currently queued, as the browser would on its next paint. */
  const paint = () => {
    const due = [...frames.values()]
    frames.clear()
    due.forEach((callback) => callback(0))
  }

  beforeEach(() => {
    frames = new Map()
    nextId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(nextId, callback)
      return nextId++
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('draws nothing until a frame is asked for', () => {
    const draw = vi.fn(() => false)
    createRenderLoop(draw)
    paint()
    expect(draw).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('draws once for any number of requests before the next paint', () => {
    const draw = vi.fn(() => false)
    const loop = createRenderLoop(draw)
    loop.request()
    loop.request()
    loop.request()
    expect(frames.size).toBe(1)
    paint()
    expect(draw).toHaveBeenCalledTimes(1)
    // A still scene asks for nothing more.
    expect(frames.size).toBe(0)
  })

  it('keeps drawing while the scene is moving, then stops', () => {
    let moving = 3
    const draw = vi.fn(() => --moving > 0)
    const loop = createRenderLoop(draw)
    loop.request()
    paint()
    paint()
    paint()
    expect(draw).toHaveBeenCalledTimes(3)
    paint()
    expect(draw).toHaveBeenCalledTimes(3)
    expect(frames.size).toBe(0)
  })

  it('a request made while drawing gets its own frame', () => {
    const loop = createRenderLoop(
      vi.fn(() => {
        loop.request()
        return false
      })
    )
    loop.request()
    paint()
    expect(frames.size).toBe(1)
  })

  it('stop drops a pending frame and ignores later requests', () => {
    const draw = vi.fn(() => true)
    const loop = createRenderLoop(draw)
    loop.request()
    loop.stop()
    expect(frames.size).toBe(0)
    loop.request()
    paint()
    expect(draw).not.toHaveBeenCalled()
  })

  it('a frame already running when stopped does not draw', () => {
    const draw = vi.fn(() => true)
    const loop = createRenderLoop(draw)
    loop.request()
    const due = [...frames.values()]
    // The browser has taken the callback; cancelling can no longer prevent it.
    vi.stubGlobal('cancelAnimationFrame', () => {})
    loop.stop()
    due.forEach((callback) => callback(0))
    expect(draw).not.toHaveBeenCalled()
  })
})
