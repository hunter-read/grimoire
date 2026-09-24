import { useCallback, useLayoutEffect, useRef, useState } from 'react'

// Breathing room kept between the menu and the viewport edge, so a clamped menu
// never sits flush against the window.
const MARGIN = 8

/**
 * Places a portalled panel next to the trigger that opened it, keeping it fully
 * on screen.
 *
 * Every anchored dropdown in the app used to carry its own copy of this math,
 * and every copy clamped the horizontal axis only: `top` was hardcoded to
 * `trigger.bottom + 4` with nothing stopping it running off the end of the
 * window. Opening a menu from a row near the bottom of the page pushed its lower
 * entries — usually the destructive ones — past the viewport with no way to
 * scroll to them (issue #465). The few menus that did clamp vertically did it
 * against a hardcoded height guess, which goes wrong as soon as the menu's
 * contents are conditional, which they all are.
 *
 * So the panel measures itself, the way the file manager's ContextMenu already
 * does. It renders hidden at a provisional spot, and a layout effect (before
 * paint, so there is no visible jump) reads its real box and picks the final
 * placement: below the trigger when it fits, flipped above when it doesn't and
 * there is room up there, otherwise clamped to the viewport edge. A panel taller
 * than the window pins to the top and scrolls internally rather than overflowing
 * off both ends.
 *
 * Returns refs for the trigger and the panel, the resolved `style` to spread
 * onto the panel, and `place` to re-run placement (already wired to scroll and
 * resize while open).
 *
 * @param {boolean} open      Whether the panel is currently rendered.
 * @param {object}  [options]
 * @param {number}  [options.width]  Fixed panel width; omit to let content size it.
 * @param {'left'|'right'} [options.align='right']  Which trigger edge to align to.
 * @param {number}  [options.gap=4]  Space between the trigger and the panel.
 * @param {object}  [options.anchorRef]  Anchor owned by the caller, for the
 *   components whose trigger is rendered somewhere else; defaults to the
 *   `triggerRef` returned here.
 */
export default function useAnchoredMenu(open, { width, align = 'right', gap = 4, anchorRef } = {}) {
  const ownTriggerRef = useRef(null)
  const triggerRef = anchorRef ?? ownTriggerRef
  // Held in a ref so `place` keeps a stable identity: a caller that passes a
  // freshly-built anchor object each render would otherwise re-create `place`,
  // re-run the layout effect, and spin.
  const anchor = useRef(triggerRef)
  anchor.current = triggerRef
  const panelRef = useRef(null)
  // null until measured; the panel stays invisible (but laid out, so it has a
  // box to read) for that first pass.
  const [pos, setPos] = useState(null)
  const [maxHeight, setMaxHeight] = useState(null)

  const place = useCallback(() => {
    const trigger = anchor.current.current
    const panel = panelRef.current
    if (!trigger || !panel) return

    const r = trigger.getBoundingClientRect()
    const box = panel.getBoundingClientRect()
    const panelWidth = width ?? box.width
    // The panel may already be clamped to a scrolling maxHeight from an earlier
    // pass, so measure what it *wants* to be, not what it was last cut down to.
    const height = panel.scrollHeight || box.height
    const vw = window.innerWidth
    const vh = window.innerHeight
    const room = vh - 2 * MARGIN

    let top
    let limit = null
    if (height > room) {
      // Taller than the window: it has to scroll, so anchor it at the top.
      top = MARGIN
      limit = room
    } else if (r.bottom + gap + height + MARGIN <= vh) {
      top = r.bottom + gap // fits below the trigger, the normal case
    } else if (r.top - gap - height - MARGIN >= 0) {
      top = r.top - gap - height // flip above the trigger
    } else {
      top = vh - height - MARGIN // clamp to the bottom edge
    }

    const preferred = align === 'left' ? r.left : r.right - panelWidth
    const left = Math.max(MARGIN, Math.min(preferred, vw - MARGIN - panelWidth))

    // Scroll fires constantly; skip the re-render when the placement is
    // unchanged, which is the common case while scrolling a pinned menu.
    setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }))
    setMaxHeight(limit)
  }, [width, align, gap])

  useLayoutEffect(() => {
    if (!open) {
      // Drop the stale placement so the next open measures from scratch rather
      // than flashing at wherever the panel sat last time.
      setPos(null)
      setMaxHeight(null)
      return
    }
    place()
    const onReposition = () => place()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, place])

  const style = {
    position: 'fixed',
    top: pos ? pos.top : 0,
    left: pos ? pos.left : 0,
    // Hidden rather than unmounted for the measuring pass: it needs to be in the
    // document to have a height, but must not flash at the provisional spot.
    visibility: pos ? 'visible' : 'hidden',
    ...(width != null ? { width } : null),
    ...(maxHeight != null ? { maxHeight, overflowY: 'auto' } : null),
  }

  return { triggerRef, panelRef, style, place }
}
