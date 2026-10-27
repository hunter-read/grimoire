import { useCallback, useRef, useState } from 'react'
import useSessionState from '../../hooks/useSessionState'

/**
 * Width of a pane the user can drag a divider to resize.
 *
 * The width is persisted per `key` in sessionStorage, so it survives navigating
 * away and back but resets on a full reload — the same lifetime as the other
 * layout preferences in the app.
 *
 * Returns the current `width`, a `dragging` flag (for cursor/highlight
 * feedback), and `handleProps` to spread onto the divider element. The divider
 * is a focusable separator: pointer drag for the mouse, arrow keys for the
 * keyboard, so the pane isn't resizable by mouse alone.
 *
 * @param {string} key         sessionStorage key
 * @param {object} options
 * @param {number} options.initial  starting width in px
 * @param {number} options.min      smallest allowed width
 * @param {number} options.max      largest allowed width
 * @param {number} options.step     px moved per arrow-key press
 */
export default function useResizableWidth(
  key,
  { initial = 240, min = 160, max = 520, step = 16 } = {}
) {
  const [stored, setStored] = useSessionState(key, initial)
  const [dragging, setDragging] = useState(false)
  // Where the pointer went down, and how wide the pane was at that moment —
  // the drag applies the delta between them, so grabbing the divider anywhere
  // along its length feels the same and there's no jump on the first move.
  const origin = useRef(null)

  const clamp = useCallback((w) => Math.min(max, Math.max(min, w)), [min, max])

  // A stale stored value (e.g. saved before the limits changed) is corrected on
  // read rather than written back, so nothing is persisted until a real drag.
  const width = clamp(typeof stored === 'number' && !Number.isNaN(stored) ? stored : initial)

  const onPointerDown = useCallback(
    (e) => {
      // Ignore secondary buttons so a right-click never starts a drag.
      if (e.button !== 0) return
      e.preventDefault()
      origin.current = { x: e.clientX, width }
      setDragging(true)
      // Capture keeps move/up events coming to the divider even while the
      // pointer is out over the note pane, where they'd otherwise be lost.
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    [width]
  )

  const onPointerMove = useCallback(
    (e) => {
      const start = origin.current
      if (!start) return
      setStored(clamp(start.width + (e.clientX - start.x)))
    },
    [clamp, setStored]
  )

  const endDrag = useCallback((e) => {
    if (!origin.current) return
    origin.current = null
    setDragging(false)
    e?.currentTarget?.releasePointerCapture?.(e.pointerId)
  }, [])

  const onKeyDown = useCallback(
    (e) => {
      const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      if (!delta) return
      e.preventDefault()
      setStored(clamp(width + delta))
    },
    [clamp, setStored, step, width]
  )

  return {
    width,
    dragging,
    handleProps: {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-valuenow': width,
      'aria-valuemin': min,
      'aria-valuemax': max,
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
    },
  }
}
