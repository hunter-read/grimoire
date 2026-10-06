import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard behaviour every modal dialog needs, in one place.
 *
 * On open, focus moves into the dialog - to `initialFocusRef` if given, else
 * its first control - so a keyboard or screen-reader user lands in it rather
 * than behind it. Tab and Shift+Tab cycle inside the dialog, Escape calls
 * `onClose`, and on close focus returns to whatever opened it.
 *
 * Escape is handled on the dialog element rather than the window, so with one
 * dialog stacked on another only the one holding focus closes.
 */
export default function useDialogFocus(ref, { onClose, initialFocusRef } = {}) {
  // The latest onClose, read at keypress time: a parent passing an inline
  // function must not leave a stale one wired up.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const opener = typeof document !== 'undefined' ? document.activeElement : null

    const target = initialFocusRef?.current || node.querySelector(FOCUSABLE) || node
    target.focus?.()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...node.querySelectorAll(FOCUSABLE)].filter(
        (el) => !el.closest('[aria-hidden="true"]')
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus()
      }
    }
    // Run once per mount: re-running on every render would yank focus back to
    // the first control while the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
