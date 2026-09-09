import { useLayoutEffect, useRef, useState } from 'react'

// Breathing room kept between the menu and the viewport edge, so a clamped
// menu never sits flush against the window.
const MARGIN = 8

/**
 * The file manager's right-click menu, positioned so it is always fully on
 * screen.
 *
 * The position used to be clamped against a hardcoded height guess, which was
 * wrong for most of the menus this renders: a folder's menu (download, new
 * folder, two upload rows, scaffold, pin, container kind, NSFW, move, rename,
 * delete) is roughly half again as tall as a file's, so right-clicking a row
 * near the bottom of the pane pushed the lower entries — delete, rename, move —
 * off the bottom of the window where they could not be reached.
 *
 * So the menu measures itself instead of being guessed at. It renders hidden at
 * the click point, and a layout effect (before paint, so there is no visible
 * jump) reads its real box and picks the final spot: flipped above the cursor
 * when there is room there and not below, otherwise clamped to the viewport.
 * If it is taller than the viewport even then — a long container-kind list on a
 * short window — it pins to the top and scrolls internally rather than
 * overflowing off both ends.
 */
export default function ContextMenu({ x, y, onClick, children }) {
  const ref = useRef(null)
  // null until measured; the menu stays invisible (but laid out, so it has a
  // height to read) for that first pass.
  const [pos, setPos] = useState(null)
  const [maxHeight, setMaxHeight] = useState(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const room = vh - 2 * MARGIN

    let top
    if (height > room) {
      // Taller than the window: it has to scroll, so anchor it at the top.
      top = MARGIN
      setMaxHeight(room)
    } else if (y + height + MARGIN <= vh) {
      top = y // fits below the cursor, the normal case
    } else if (y - height - MARGIN >= 0) {
      top = y - height // flip above, keeping the cursor on the menu's edge
    } else {
      top = vh - height - MARGIN // clamp to the bottom
    }

    // Horizontal follows the same rule: prefer right of the cursor, flip left
    // when that overflows, clamp if neither fits.
    let left
    if (x + width + MARGIN <= vw) left = x
    else if (x - width - MARGIN >= 0) left = x - width
    else left = Math.max(MARGIN, vw - width - MARGIN)

    setPos({ top, left })
  }, [x, y])

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="file-context-menu"
      style={{
        position: 'fixed',
        top: pos ? pos.top : y,
        left: pos ? pos.left : x,
        // Hidden rather than unmounted for the measuring pass: it needs to be in
        // the document to have a height, but must not flash at the raw click
        // point first.
        visibility: pos ? 'visible' : 'hidden',
        maxHeight: maxHeight ?? undefined,
        overflowY: maxHeight ? 'auto' : undefined,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 4,
        zIndex: 900,
        minWidth: 220,
        boxShadow: '0 8px 24px var(--overlay)',
      }}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
