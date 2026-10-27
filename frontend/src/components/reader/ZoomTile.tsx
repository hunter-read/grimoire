import { useState, type CSSProperties } from 'react'
import RetryingImage from './RetryingImage'

interface Props {
  src: string
  rect: CSSProperties
  priority?: 'high' | 'low' | 'auto'
}

/**
 * One zoom tile: invisible until its image has loaded, then faded in over the
 * softer whole-page image beneath, so the page sharpens rather than having
 * squares pop in. A tile the server was too busy to render is asked for again.
 */
export default function ZoomTile({ src, rect, priority }: Props) {
  const [loaded, setLoaded] = useState(false)
  return (
    <RetryingImage
      src={src}
      alt=""
      draggable={false}
      fetchPriority={priority}
      onLoad={() => setLoaded(true)}
      style={{
        position: 'absolute',
        ...rect,
        display: 'block',
        opacity: loaded ? 1 : 0,
        transition: 'opacity 150ms ease-out',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    />
  )
}
