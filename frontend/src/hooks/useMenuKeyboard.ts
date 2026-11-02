import { useEffect, useRef, type RefObject } from 'react'

const ITEM_SELECTOR = ['menuitem', 'menuitemradio', 'menuitemcheckbox']
  .map((role) => `[role="${role}"]:not([disabled]):not([aria-disabled="true"])`)
  .join(', ')

/**
 * Keyboard support for a `role="menu"` popup, per the WAI-ARIA menu button
 * pattern. The menus here are portaled to the end of <body>, so without this a
 * keyboard or screen reader user who opens one cannot reach its items at all:
 * Tab from the trigger walks on through the page, never into the popup.
 *
 * While `open`:
 * - focus moves to the first item;
 * - ArrowDown / ArrowUp step through the items (wrapping), Home / End jump;
 * - Escape closes and puts focus back on the trigger;
 * - Tab closes and returns to the trigger, so the next Tab carries on from
 *   where the menu was opened rather than from the end of the document.
 *
 * Items are looked up on each key press, so a menu whose items change while it
 * is open (an item unfolding a field) keeps working.
 */
export default function useMenuKeyboard(
  open: boolean,
  menuRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  // The latest close handler, without re-binding the listener for each one.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const menu = menuRef.current
    if (!open || !menu) return undefined
    const items = () => [...menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)]
    items()[0]?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      const list = items()
      const index = list.indexOf(document.activeElement as HTMLElement)
      let next: HTMLElement | undefined
      switch (e.key) {
        case 'ArrowDown':
          next = list[(index + 1) % list.length]
          break
        case 'ArrowUp':
          next = list[(index - 1 + list.length) % list.length]
          break
        case 'Home':
          next = list[0]
          break
        case 'End':
          next = list[list.length - 1]
          break
        case 'Escape':
        case 'Tab':
          e.preventDefault()
          e.stopPropagation()
          close.current()
          triggerRef.current?.focus()
          return
        default:
          return
      }
      // A text field inside the menu keeps its own arrow and Home/End keys.
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      e.preventDefault()
      next?.focus()
    }
    menu.addEventListener('keydown', onKeyDown)
    return () => menu.removeEventListener('keydown', onKeyDown)
  }, [open, menuRef, triggerRef])
}
