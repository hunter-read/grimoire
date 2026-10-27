import { useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../api'
import type { RefObject } from 'react'
import ZoomTile from './ZoomTile'
import type { Tile } from './zoomTileGeometry'
import { needsTiles, tileRect, tileWidthFor, visibleTiles } from './zoomTileGeometry'

// Tiles are worked out once zooming or panning has been still this long, so a
// pinch or a fast pan doesn't queue renders for views already left behind.
const SETTLE_MS = 150

export interface ZoomTilesProps {
  bookId: string
  page: number
  /** The book's content hash, so a replaced file's tiles are not served stale. */
  contentToken?: string | null
  /** Page height / width. */
  aspect: number
  zoom: number
  pan: { x: number; y: number }
  /** The width the whole-page image was rendered at. */
  imageWidth: number
  /** The scrolling viewport the tiles are clipped to. */
  viewRef?: RefObject<HTMLElement | null>
  rounded?: boolean
}

/**
 * Sharp tiles of the visible part of a page, laid over the whole-page image
 * once zoom outruns what that image can show (issue #574).
 *
 * Fills the page box it is placed in (which must be `position: relative`), and
 * positions tiles as percentages of it, so they scale and pan with the page
 * under the reader's transform without being measured again.
 *
 * `aspect` is the page's height / width; `imageWidth` the width the whole-page
 * image was requested at; `viewRef` the reader's visible area. `rounded` matches
 * a standalone page's corners; a joined spread's pages are square inside it.
 */
export default function ZoomTiles({
  bookId,
  page,
  contentToken,
  aspect,
  zoom,
  pan,
  imageWidth,
  viewRef,
  rounded = true,
}: ZoomTilesProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{ width: number; tiles: Tile[] }>({ width: 0, tiles: [] })

  useEffect(() => {
    const update = () => {
      const box = boxRef.current
      const view = viewRef?.current
      if (!box || !view) return
      // offsetWidth is the layout width, before the zoom transform.
      const width = tileWidthFor(box.offsetWidth, zoom, window.devicePixelRatio)
      if (zoom <= 1 || !needsTiles(width, imageWidth)) {
        setLayout((prev) => (prev.tiles.length ? { width: 0, tiles: [] } : prev))
        return
      }
      const tiles = visibleTiles({
        width,
        aspect,
        box: box.getBoundingClientRect(),
        view: view.getBoundingClientRect(),
      })
      setLayout({ width, tiles })
    }
    let timer = setTimeout(update, SETTLE_MS)
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(update, SETTLE_MS)
    }
    // The page box has no size until its image arrives (it is sized by
    // aspect-ratio around it), which on a page turned while zoomed is after the
    // first measurement. Watching the box catches that, and window resizes.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (boxRef.current) observer?.observe(boxRef.current)
    window.addEventListener('resize', schedule)
    return () => {
      clearTimeout(timer)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [zoom, pan, aspect, imageWidth, viewRef])

  const { width, tiles } = layout
  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        borderRadius: rounded ? 4 : 0,
        pointerEvents: 'none',
      }}
    >
      {tiles.map(({ col, row, priority }) => (
        <ZoomTile
          key={`${width}:${col}:${row}`}
          src={mediaUrl(`/books/${bookId}/page/${page}/tile`, {
            width,
            col,
            row,
            ...(contentToken ? { v: contentToken } : {}),
          })}
          rect={tileRect(col, row, width, aspect)}
          priority={priority}
        />
      ))}
    </div>
  )
}
