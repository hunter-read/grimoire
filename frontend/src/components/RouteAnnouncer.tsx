import { useEffect, useRef, useState, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { APP_TITLE } from '../hooks/usePageTitle'

/**
 * Tells a screen reader that an in-app navigation happened.
 *
 * A full page load announces the new page by itself; a client-side route change
 * does not, so a blind user who follows a link hears nothing and is left
 * wherever focus happened to be. This does what the browser would have:
 *
 * - Moves focus to `<main>` when the element that had it is gone (the card
 *   that was clicked unmounted with its page) or sits outside `<main>` (a
 *   sidebar link). Focus inside `<main>` that survived the change - a tab in a
 *   tab strip - is left alone, so switching tabs does not throw the user out.
 * - Reads the page title out in a polite live region once the new view sets
 *   one (usePageTitle), if it differs from the one before. The plain app name
 *   is skipped: it would be announced for every page that has not named
 *   itself yet.
 */
export default function RouteAnnouncer({ mainRef }: { mainRef: RefObject<HTMLElement | null> }) {
  const { pathname } = useLocation()
  const [message, setMessage] = useState('')
  const first = useRef(true)
  // Set by a navigation, consumed by the next title change it causes.
  const pending = useRef(false)
  // The title the user already knows about. A navigation that leaves it as it
  // was (a tab switch within one page) has nothing new to say.
  const shown = useRef(document.title)

  const announce = (title: string) => {
    setMessage(title)
    shown.current = title
    pending.current = false
  }

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const main = mainRef.current
    const active = document.activeElement
    if (main && (!active || active === document.body || !main.contains(active))) {
      main.focus({ preventScroll: true })
    }
    // A view that already set its title on this render (it was cached) has
    // changed it before this effect ran, so read it now; otherwise wait for it.
    if (document.title !== APP_TITLE && document.title !== shown.current) announce(document.title)
    else pending.current = true
  }, [pathname, mainRef])

  useEffect(() => {
    const titleEl = document.querySelector('title')
    if (!titleEl || typeof MutationObserver === 'undefined') return undefined
    const observer = new MutationObserver(() => {
      const title = document.title
      // The bare app name is never announced, but it does reset what was last
      // said, so coming back to the page before is news again.
      if (title === APP_TITLE) shown.current = title
      else if (pending.current && title !== shown.current) announce(title)
      else if (!pending.current) shown.current = title
    })
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  )
}
