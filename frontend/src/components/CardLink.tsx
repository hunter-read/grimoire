import { Link } from 'react-router-dom'

/**
 * True when a mouse click should be left to the browser (new tab, new window,
 * context menu): any modifier key held, or a non-primary button.
 */
export function isModifiedClick(e) {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
}

/**
 * Stretched link that turns a whole card into a real anchor (issue #313).
 *
 * Cards nest their own controls (favorite toggles, kebab menus, audio players),
 * which can't legally live inside an <a>. So instead of wrapping the card, the
 * card stays a positioned <div> and this renders as its first child: an
 * absolutely-positioned anchor covering it. Interactive children rendered after
 * it opt back out of the link by being positioned themselves (relative or
 * absolute), which paints them above the overlay.
 *
 * Being a real anchor, every browser affordance works without JS: middle click
 * and ctrl/cmd-click open a new tab, right-click offers "Open in new tab" and
 * "Copy link", the target previews in the status bar, and Enter activates it
 * from the keyboard.
 *
 * `to` (with optional `state`/`replace`) renders a router <Link>; `href` (with
 * optional `download`) renders a plain <a> for non-route targets like file
 * downloads. `label` is the accessible name — the overlay has no text of its
 * own, so always pass one.
 *
 * Callers that pass `state={{ from: … }}` (so the reader's back button can
 * return to the referring view) must capture it from `useLocation()` in the
 * card's own render. A <Link> fixes its state at render time, unlike the
 * `navigate()` handlers this replaced, which read `window.location` at click
 * time and so could never go stale. That makes it correct only while the card
 * re-renders on navigation: memoizing a card, or hoisting the `useLocation()`
 * call into a parent that renders on a different cadence, would freeze `from`
 * at its mount value and send the back button to a stale URL. See the
 * regression test in PageHit.test.jsx.
 */
export default function CardLink({ to, state, replace, href, download, label }) {
  const style = { position: 'absolute', inset: 0 }
  if (href) {
    return <a href={href} download={download} aria-label={label} style={style} />
  }
  return <Link to={to} state={state} replace={replace} aria-label={label} style={style} />
}
