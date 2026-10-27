import { useCallback, useEffect, useRef } from 'react'

// How long a finger must stay down before it counts as a long press. Matches
// the platform convention on both iOS and Android closely enough that it feels
// native rather than sluggish.
const HOLD_MS = 500

// How far the finger may drift and still be a press rather than a scroll. The
// tree scrolls vertically under these rows, so a hold that starts a flick must
// not also open a menu.
const MOVE_TOLERANCE_PX = 10

/**
 * Long-press as a stand-in for right-click, for touch devices that have no
 * second mouse button.
 *
 * The file manager's every per-item action — rename, move, delete, upload,
 * pin — lives behind the context menu, which on a phone or tablet was simply
 * unreachable: `contextmenu` fires from a real right-click, and a touch browser
 * either does not fire it at all or fires it only after its own text-selection
 * UI has already appeared.
 *
 * So the press is timed by hand. `touchstart` arms a timer; movement past
 * `MOVE_TOLERANCE_PX` or an early `touchend` disarms it; if it survives, the
 * callback runs with the touch's coordinates, which is exactly the shape a
 * mouse `contextmenu` handler already takes.
 *
 * The tap that ends the press is then swallowed. A touch that opens a menu
 * still ends in `touchend` → a synthesised `click`, which would otherwise
 * select the row behind the menu — or, worse, reach the window-level listener
 * that closes the menu and shut it in the same gesture that opened it.
 *
 * Returns props to spread onto the element. `onClickCapture` is part of them:
 * it belongs to the same gesture and has to run before the element's own
 * `onClick`.
 */
export default function useLongPress(onLongPress) {
  const timer = useRef(null)
  const start = useRef(null)
  // Set when the timer fires, read (and cleared) by the click it must swallow.
  const fired = useRef(false)
  // Held in a ref so the returned handlers keep one identity for the life of
  // the component. The tree is virtualised and its rows are memoised; handlers
  // that changed on every render — which an inline `(e) => onContext(e, entry)`
  // callback would cause — would defeat that and re-render every visible row on
  // each scroll frame.
  const callback = useRef(onLongPress)
  callback.current = onLongPress

  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }, [])

  // A component unmounting mid-press — the pane closing, the tree scrolling a
  // row out of the virtual window — must not leave a timer that fires into a
  // dead component.
  useEffect(() => cancel, [cancel])

  const onTouchStart = useCallback(
    (e) => {
      // A second finger means a pinch or a two-finger scroll, not a press.
      if (e.touches.length !== 1) return cancel()
      const t = e.touches[0]
      start.current = { x: t.clientX, y: t.clientY }
      fired.current = false
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        fired.current = true
        callback.current({
          clientX: t.clientX,
          clientY: t.clientY,
          // The caller's handler is shared with the mouse path, which calls
          // both of these; neither means anything for a touch that has already
          // been held past the point of being a tap.
          preventDefault: () => {},
          stopPropagation: () => {},
        })
      }, HOLD_MS)
    },
    [cancel]
  )

  const onTouchMove = useCallback(
    (e) => {
      if (!timer.current || !start.current) return
      const t = e.touches[0]
      if (!t) return
      const { x, y } = start.current
      if (
        Math.abs(t.clientX - x) > MOVE_TOLERANCE_PX ||
        Math.abs(t.clientY - y) > MOVE_TOLERANCE_PX
      ) {
        cancel()
      }
    },
    [cancel]
  )

  const onClickCapture = useCallback((e) => {
    if (!fired.current) return
    fired.current = false
    e.preventDefault()
    e.stopPropagation()
    // React's synthetic `stopPropagation` only stops React's own tree walk; the
    // native event carries on to `window`, where the menu's own
    // close-on-outside-click listener is waiting. Stopping it there too is what
    // keeps the menu open past the gesture that opened it.
    e.nativeEvent?.stopImmediatePropagation?.()
  }, [])

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onClickCapture,
  }
}
