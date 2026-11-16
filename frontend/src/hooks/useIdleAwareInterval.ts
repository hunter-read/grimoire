import { useEffect, useRef } from 'react'
import { startIdleAwareInterval } from '../lib/userActivity'

/**
 * `setInterval` for background polling: runs `callback` every `ms` only while
 * someone is using the tab (see `startIdleAwareInterval`). Pass `null` for `ms`
 * to switch the interval off.
 *
 * The callback is held in a ref, so an inline arrow doesn't restart the timer.
 */
export default function useIdleAwareInterval(callback: () => void, ms: number | null): void {
  const ref = useRef(callback)
  ref.current = callback

  useEffect(() => {
    if (ms === null) return undefined
    return startIdleAwareInterval(() => ref.current(), ms)
  }, [ms])
}
