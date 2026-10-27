import { useState } from 'react'

/**
 * One zoom tile: invisible until its image has loaded, then faded in over the
 * softer whole-page image beneath, so the page sharpens rather than having
 * squares pop in.
 */
export default function ZoomTile({ src, rect, priority }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      // Lower-case so React passes it through as the HTML attribute.
      fetchpriority={priority}
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
