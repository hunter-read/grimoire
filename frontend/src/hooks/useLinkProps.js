import { useCallback } from 'react'

/**
 * Returns true when a mouse event should open the target in a new tab rather
 * than navigating in place: middle click, or ctrl/cmd/shift-click (issue #313).
 */
export function isNewTabClick(e) {
  if (!e) return false
  // `auxclick` fires for every non-primary button; only the middle one (1)
  // means "open in a new tab". The right button opens the context menu.
  if (e.type === 'auxclick') return e.button === 1
  // `button` is often absent on synthetic clicks, where 0 (primary) is implied.
  return !e.button && !!(e.metaKey || e.ctrlKey || e.shiftKey)
}

/**
 * Opens an in-app path in a new browser tab. Paths are absolute app routes and
 * the app mounts BrowserRouter at the origin root with no basename, so the
 * route and the URL are the same string.
 */
function openInNewTab(to) {
  // noopener/noreferrer: the new tab must not get a handle on this window.
  window.open(to, '_blank', 'noopener,noreferrer')
}

/**
 * Props that turn a non-anchor element (a card `<div>`, a chip `<button>`) into
 * something that behaves like a real link for mouse users.
 *
 * Cards across the app navigate with `navigate()` from an `onClick` handler
 * rather than rendering an `<a>`, because they nest their own buttons — favorite
 * toggles, kebab menus, download actions — which may not legally live inside an
 * anchor, and because bulk-select mode reuses the same click target for
 * selection. That left middle click doing nothing at all (issue #313).
 *
 * This hook keeps the existing click behaviour and layers link semantics on top:
 *
 * - `onClick` — a plain click runs `onActivate` (the caller's normal handler);
 *   ctrl/cmd/shift-click opens `to` in a new tab instead.
 * - `onAuxClick` — middle click opens `to` in a new tab.
 * - `data-href` — the target route, so tests and tooling can see where it goes.
 *
 * `to` may be null (a card in bulk-select mode, an item with no route), in which
 * case the new-tab paths are skipped and `onActivate` always runs.
 *
 * Deliberately does not use `useNavigate`/`useHref`: these chips and cards are
 * rendered — and unit-tested — outside a Router in several places, and needing
 * a Router context just to compute a URL would be a needless coupling.
 *
 * Spread onto the clickable element:
 *
 *   const linkProps = useLinkProps(`/library/system/${id}`, handleClick)
 *   <div {...linkProps} role="button" tabIndex={0}>…</div>
 */
export default function useLinkProps(to, onActivate) {
  const onClick = useCallback(
    (e) => {
      if (to && isNewTabClick(e)) {
        e.preventDefault()
        e.stopPropagation()
        openInNewTab(to)
        return
      }
      onActivate?.(e)
    },
    [to, onActivate]
  )

  const onAuxClick = useCallback(
    (e) => {
      if (!to || !isNewTabClick(e)) return
      // Firefox otherwise starts autoscroll on middle click.
      e.preventDefault()
      e.stopPropagation()
      openInNewTab(to)
    },
    [to]
  )

  return { onClick, onAuxClick, 'data-href': to || undefined }
}

/**
 * Variant for callers that already own their `onClick` and only need the
 * new-tab affordances — click handlers where rewriting the existing logic would
 * be more churn than it's worth.
 */
export function useNewTabHandler(to) {
  return useCallback(
    (e) => {
      if (!to || !isNewTabClick(e)) return
      e.preventDefault()
      e.stopPropagation()
      openInNewTab(to)
    },
    [to]
  )
}
