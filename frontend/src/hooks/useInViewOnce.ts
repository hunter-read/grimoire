import { useEffect, useState, type RefObject } from 'react'

/**
 * Whether `ref`'s element has come within `rootMargin` of the viewport yet.
 *
 * Latches: once true it stays true, so work started on first sight (a fetch, a
 * render) isn't thrown away when the element scrolls back out. Without
 * IntersectionObserver it is true straight away, so the element still renders.
 */
export default function useInViewOnce(
  ref: RefObject<Element | null>,
  rootMargin = '200px'
): boolean {
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (seen || !el) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, rootMargin, seen])

  return seen
}
