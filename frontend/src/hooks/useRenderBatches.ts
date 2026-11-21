import { startTransition, useEffect, useState } from 'react'

/**
 * How many rows of a long list to render so far: `first` straight away, then
 * `step` more each frame until all `total` are in.
 *
 * Building every card of a large library at once (thousands of systems) held
 * the page blank for half a second after its data arrived. In batches the
 * first screenful paints at once and the rest follows over the next few frames,
 * each batch after the browser has painted the last, and as a transition, so a
 * click or a keystroke is never stuck behind it.
 *
 * The count only grows: once a list is all in, filtering or re-sorting it
 * renders the result whole, as before.
 */
export default function useRenderBatches(total: number, first = 120, step = 240): number {
  const [limit, setLimit] = useState(first)

  useEffect(() => {
    if (limit >= total) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // A frame first, so the batch already rendered gets painted before the
    // next one is built.
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => startTransition(() => setLimit((n) => n + step)))
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [limit, total, step])

  return limit
}
