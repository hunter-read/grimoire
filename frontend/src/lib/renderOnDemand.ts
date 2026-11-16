/**
 * Draw a scene only when something about it has changed.
 *
 * A viewer that redraws on every animation frame keeps the GPU and a CPU core
 * busy for as long as its page is open, even with a still model that nobody is
 * touching (measured: 60 frames a second, 3% of a core, for an idle 3D model).
 * Here a frame is drawn when one is asked for, and frames keep coming only
 * while `draw` says the scene is still moving, as it is while a damped orbit
 * coasts to a stop.
 */
export interface RenderLoop {
  /** Ask for a frame. Any number of requests before the next frame draw once. */
  request(): void
  /** Stop for good, dropping a frame that was asked for but not drawn. */
  stop(): void
}

/** `draw` renders one frame and returns whether another is needed straight after. */
export function createRenderLoop(draw: () => boolean): RenderLoop {
  let frame = 0
  let stopped = false

  const request = () => {
    if (stopped || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (stopped) return
      if (draw()) request()
    })
  }

  return {
    request,
    stop() {
      stopped = true
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
