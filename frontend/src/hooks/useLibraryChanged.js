import { useEffect, useRef } from 'react'
import { LIBRARY_CHANGED } from './useFileActions'

/**
 * Run `handler` whenever a file is moved, renamed, or deleted anywhere in the app.
 *
 * The counterpart to `useFileActions`' broadcast. A view showing library content
 * has no other way to learn that a menu several components below it just deleted
 * one of the rows it is rendering — and the alternative, threading a refresh
 * callback down through every intermediate component, makes those components
 * carry a prop they have no use for.
 *
 * The handler is held in a ref so a caller can pass an inline arrow without
 * re-subscribing on every render, which is the shape nearly every call site
 * wants.
 */
export default function useLibraryChanged(handler) {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    const onChanged = (e) => ref.current?.(e.detail)
    window.addEventListener(LIBRARY_CHANGED, onChanged)
    return () => window.removeEventListener(LIBRARY_CHANGED, onChanged)
  }, [])
}
