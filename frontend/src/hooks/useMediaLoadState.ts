import { useCallback, useState } from 'react'

/**
 * Whether the image or video shown for `key` has loaded, or failed to.
 *
 * A new key reads as neither until its own media reports in. That is held as
 * *which key* loaded rather than as a flag an effect resets on every key
 * change: a cached image fires its load event as soon as it is attached, and
 * React 19 runs passive effects later than React 18 did - so the reset landed
 * after the load and left the image hidden behind its spinner for good, which
 * is what a reloaded map page did.
 */
export default function useMediaLoadState(key: string | number) {
  const [loadedFor, setLoadedFor] = useState<string | number | null>(null)
  const [failedFor, setFailedFor] = useState<string | number | null>(null)
  const onLoad = useCallback(() => setLoadedFor(key), [key])
  const onError = useCallback(() => setFailedFor(key), [key])
  return { loaded: loadedFor === key, failed: failedFor === key, onLoad, onError }
}
