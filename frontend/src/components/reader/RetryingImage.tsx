import { useEffect, useRef, useState, type ImgHTMLAttributes, type SyntheticEvent } from 'react'

// How long to wait before each new request for an image that failed to load.
// The server answers a page or tile 503 when too many are already rendering
// (issue #701); an <img> can't see the status or its Retry-After, so it backs
// off by itself, and gives up after the last.
export const RETRY_DELAYS_MS = [1000, 2000, 4000]

type Props = ImgHTMLAttributes<HTMLImageElement> & { src: string }

/**
 * An <img> that asks for its image again, a few times and further apart each
 * time, when it fails to load. Each retry is a fresh element for the same URL,
 * so the image that finally loads is the one the browser caches under it.
 */
export default function RetryingImage({ src, onError, alt, ...rest }: Props) {
  // Keyed by src, so a new image starts with every retry still to come.
  const [retry, setRetry] = useState({ src, attempt: 0 })
  const attempt = retry.src === src ? retry.attempt : 0
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [src])

  const handleError = (e: SyntheticEvent<HTMLImageElement>) => {
    onError?.(e)
    if (attempt >= RETRY_DELAYS_MS.length) return
    clearTimeout(timer.current)
    timer.current = setTimeout(
      () => setRetry({ src, attempt: attempt + 1 }),
      RETRY_DELAYS_MS[attempt]
    )
  }

  return <img key={attempt} {...rest} alt={alt} src={src} onError={handleError} />
}
