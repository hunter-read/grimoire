import scrollParent from './scrollParent'

// How long to wait for a smooth scroll to end where `scrollend` is missing.
const SETTLE_FALLBACK = 700

// What takes focus inside a jumped-to row: its own link or button.
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Scroll a run's first row into view and move focus to it.
 *
 * The row is found by its `data-index-key`, inside `container`. Focus goes to
 * the first link or button in it (a card's own link), so a keyboard user
 * continues from the row they jumped to and a screen reader announces it; a
 * row with nothing focusable takes focus itself. The scroll is instant under
 * reduced motion. Returns whether the row was found.
 *
 * Once a smooth scroll ends the row is aligned again, instantly, in case
 * anything above it changed height on the way (a folder's images arriving).
 */
export default function jumpToSection(container: HTMLElement | null, key: string): boolean {
  const anchors = container?.querySelectorAll<HTMLElement>('[data-index-key]') || []
  const anchor = [...anchors].find((a) => a.dataset.indexKey === key)
  if (!anchor) return false
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  anchor.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  let target = anchor.matches(FOCUSABLE) ? anchor : anchor.querySelector<HTMLElement>(FOCUSABLE)
  if (!target) {
    anchor.tabIndex = -1
    target = anchor
  }
  target.focus({ preventScroll: true })

  const scroller: HTMLElement | Window = scrollParent(anchor) || window
  let done = false
  const settle = () => {
    if (done) return
    done = true
    scroller.removeEventListener('scrollend', settle)
    anchor.scrollIntoView?.({ block: 'start', behavior: 'auto' })
  }
  scroller.addEventListener('scrollend', settle, { once: true })
  setTimeout(settle, reduce ? 0 : SETTLE_FALLBACK)
  return true
}
