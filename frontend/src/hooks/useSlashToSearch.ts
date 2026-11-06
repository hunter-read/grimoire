import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Whether a key press landed somewhere that types text. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

/**
 * `/` jumps to the page's search box, as it does on most sites with one.
 *
 * Ignored while typing in a field (so a `/` in a search still types), with a
 * modifier held, or while a modal dialog is open over the page.
 */
export default function useSlashToSearch(inputRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      if (typing(e.target)) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      const input = inputRef.current
      if (!input) return
      e.preventDefault()
      input.focus()
      input.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [inputRef])
}
