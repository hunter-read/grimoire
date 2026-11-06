import scrollParent from './scrollParent'

// How long to wait for a smooth scroll to end where `scrollend` is missing.
const SETTLE_FALLBACK = 700

/**
 * Scroll a list's section into view and move focus to its heading.
 *
 * The heading (found by its `data-index-key`, inside `container`) takes focus
 * with `tabIndex=-1`, so a keyboard user continues from the section they jumped
 * to and a screen reader announces it - "T, 9 folders". The scroll is instant
 * under reduced motion. Returns whether the section was found.
 *
 * Sections that skip rendering off screen (`content-visibility: auto`) are laid
 * out at an estimated height until they come near the viewport, so the ones a
 * long scroll passes through change size on the way and the target drifts.
 * Once the scroll ends the heading is aligned again, instantly.
 */
export default function jumpToSection(container: HTMLElement | null, key: string): boolean {
  const headings = container?.querySelectorAll<HTMLElement>('[data-index-key]') || []
  const heading = [...headings].find((h) => h.dataset.indexKey === key)
  if (!heading) return false
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  heading.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  heading.focus({ preventScroll: true })

  const scroller: HTMLElement | Window = scrollParent(heading) || window
  let done = false
  const settle = () => {
    if (done) return
    done = true
    scroller.removeEventListener('scrollend', settle)
    heading.scrollIntoView?.({ block: 'start', behavior: 'auto' })
  }
  scroller.addEventListener('scrollend', settle, { once: true })
  setTimeout(settle, reduce ? 0 : SETTLE_FALLBACK)
  return true
}
