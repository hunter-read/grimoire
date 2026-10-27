import { useState } from 'react'
import type { Tile, tileRect } from './zoomTileGeometry'

/**
 * One zoom tile: invisible until its image has loaded, then faded in over the
 * softer whole-page image beneath, so the page sharpens rather than having
 * squares pop in.
 */
export default function ZoomTile({
  src,
  rect,
  priority,
}: {
  src: string
  rect: ReturnType<typeof tileRect>
  priority: Tile['priority']
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      // Lower-case so React passes it through as the HTML attribute.
      // @ts-expect-error -- React's types only know the camel-case fetchPriority; the
      // lowercase attribute is passed through to the DOM as written.
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
