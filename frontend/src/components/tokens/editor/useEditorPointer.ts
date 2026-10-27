import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Turns mouse, wheel, keyboard, and touch input into transform actions.
 *
 * Written fresh rather than reusing `useImageGestures`: that hook is touch-only
 * and structurally tied to gallery navigation (it claims horizontal drags as
 * swipe-to-next and binds window-level arrow keys), none of which belongs in an
 * editor. The API here follows the VTT editor's `useViewport` instead, which
 * already solved zoom-toward-a-point, and the drag lifecycle follows
 * `BannerFocusPreview` — bind move/end on `document`, because releasing the
 * mouse outside the canvas is the normal way this gesture ends.
 */

const WHEEL_ZOOM_STEP = 1.1
const WHEEL_ROTATE_STEP = 2
const KEY_ROTATE_STEP = 15
const KEY_PAN_STEP = 1
const KEY_PAN_STEP_LARGE = 10

// Two-finger gestures rotate as well as zoom, but a pinch almost always carries
// a degree or two of incidental twist. Ignore rotation until the user clearly
// means it; past the threshold, track freely.
const ROTATE_DEADZONE_DEGREES = 5

const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
const angle = (a, b) => (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI
const midpoint = (a, b) => ({
  clientX: (a.clientX + b.clientX) / 2,
  clientY: (a.clientY + b.clientY) / 2,
})

export default function useEditorPointer(containerRef, actions, { disabled = false } = {}) {
  const [isDragging, setIsDragging] = useState(false)
  const drag = useRef(null)
  const pinch = useRef(null)
  // Actions are recreated per render; a ref keeps the document listeners stable.
  const latest = useRef(actions)
  latest.current = actions

  /** Client coordinates relative to the canvas centre, which is what offsets use. */
  const toCentre = useCallback(
    (clientX, clientY) => {
      const el = containerRef.current
      if (!el) return { x: 0, y: 0 }
      const rect = el.getBoundingClientRect()
      return {
        x: clientX - (rect.left + rect.width / 2),
        y: clientY - (rect.top + rect.height / 2),
      }
    },
    [containerRef]
  )

  /**
   * Scale a screen-space delta into output pixels.
   *
   * The canvas is displayed at whatever CSS size the layout gives it, but
   * offsets are in output pixels. Without this, dragging a 256px token shown at
   * 400px would move the art slower than the cursor.
   */
  const scaleDelta = useCallback(
    (delta) => {
      const el = containerRef.current
      const rect = el?.getBoundingClientRect()
      if (!rect?.width) return delta
      const size = latest.current.size || rect.width
      return (delta * size) / rect.width
    },
    [containerRef]
  )

  const onMouseDown = useCallback(
    (e) => {
      if (disabled || e.button !== 0) return
      e.preventDefault()
      drag.current = { x: e.clientX, y: e.clientY }
      setIsDragging(true)
    },
    [disabled]
  )

  // The drag continues on `document`: the pointer routinely leaves the canvas
  // mid-gesture, and a listener bound to the canvas would strand the drag.
  useEffect(() => {
    if (!isDragging) return undefined

    const onMove = (e) => {
      const start = drag.current
      if (!start) return
      latest.current.pan(scaleDelta(e.clientX - start.x), scaleDelta(e.clientY - start.y))
      drag.current = { x: e.clientX, y: e.clientY }
    }
    const onUp = () => {
      drag.current = null
      setIsDragging(false)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, scaleDelta])

  // Wheel and touch are bound imperatively with { passive: false }. React's
  // synthetic wheel/touch handlers are passive, so preventDefault() there is a
  // no-op and the page scrolls behind the canvas while the user zooms.
  useEffect(() => {
    const el = containerRef.current
    if (!el || disabled) return undefined

    const onWheel = (e) => {
      e.preventDefault()
      if (e.shiftKey) {
        latest.current.rotate(e.deltaY < 0 ? WHEEL_ROTATE_STEP : -WHEEL_ROTATE_STEP)
        return
      }
      const { x, y } = toCentre(e.clientX, e.clientY)
      latest.current.zoomAt(e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, x, y)
    }

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches
        pinch.current = {
          distance: distance(a, b),
          angle: angle(a, b),
          scale: latest.current.scale,
          rotation: latest.current.rotation,
          twisted: false,
        }
        drag.current = null
      } else if (e.touches.length === 1) {
        pinch.current = null
        drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
    }

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && pinch.current) {
        e.preventDefault()
        const [a, b] = e.touches
        const start = pinch.current

        if (start.distance > 0) {
          const centre = midpoint(a, b)
          const { x, y } = toCentre(centre.clientX, centre.clientY)
          const target = start.scale * (distance(a, b) / start.distance)
          latest.current.zoomAt(target / latest.current.scale, x, y)
        }

        let delta = angle(a, b) - start.angle
        if (delta > 180) delta -= 360
        if (delta < -180) delta += 360
        if (start.twisted || Math.abs(delta) > ROTATE_DEADZONE_DEGREES) {
          start.twisted = true
          latest.current.setRotation(start.rotation + delta)
        }
        return
      }

      if (e.touches.length === 1 && drag.current) {
        e.preventDefault()
        const touch = e.touches[0]
        latest.current.pan(
          scaleDelta(touch.clientX - drag.current.x),
          scaleDelta(touch.clientY - drag.current.y)
        )
        drag.current = { x: touch.clientX, y: touch.clientY }
      }
    }

    const onTouchEnd = (e) => {
      if (e.touches.length === 0) {
        drag.current = null
        pinch.current = null
      } else if (e.touches.length === 1) {
        pinch.current = null
        drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [containerRef, disabled, toCentre, scaleDelta])

  /**
   * Keyboard equivalents for every pointer gesture.
   *
   * Not decoration: this is the only way a keyboard-only user positions the art.
   */
  const onKeyDown = useCallback(
    (e) => {
      if (disabled) return
      const step = e.shiftKey ? KEY_PAN_STEP_LARGE : KEY_PAN_STEP
      const a = latest.current
      const handlers = {
        ArrowLeft: () => a.pan(-step, 0),
        ArrowRight: () => a.pan(step, 0),
        ArrowUp: () => a.pan(0, -step),
        ArrowDown: () => a.pan(0, step),
        '+': () => a.zoomBy(WHEEL_ZOOM_STEP),
        '=': () => a.zoomBy(WHEEL_ZOOM_STEP),
        '-': () => a.zoomBy(1 / WHEEL_ZOOM_STEP),
        '[': () => a.rotate(-KEY_ROTATE_STEP),
        ']': () => a.rotate(KEY_ROTATE_STEP),
        r: () => a.reset(),
        R: () => a.reset(),
      }
      const handler = handlers[e.key]
      if (!handler) return
      e.preventDefault()
      handler()
    },
    [disabled]
  )

  const onDoubleClick = useCallback(() => {
    if (!disabled) latest.current.reset()
  }, [disabled])

  return { isDragging, onMouseDown, onKeyDown, onDoubleClick }
}
