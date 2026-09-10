import { useCallback, useEffect, useMemo, useRef } from 'react'
import { gridToImage, imageToGrid, round4, snapToGrid, snapToHalf } from './geometry'
import { argbToCss } from './color'
import { LAYER_STYLE, POLYLINE_TOOLS, TOOL_LIGHT, TOOL_PORTAL, TOOL_SELECT } from './tools'
import useViewport from './useViewport'
import { gridOverlayStyle } from './gridOverlay'

/**
 * The drawing surface: the map image, the grid overlay, and every authored
 * feature, with the in-progress shape drawn on top.
 *
 * Features are rendered as one SVG layer inside the pan/zoom transform rather
 * than as a canvas bitmap. SVG keeps hit-testing and rendering in the same
 * coordinate space and stays crisp at any zoom, and a battlemap's worth of
 * walls is a few hundred elements — well inside what SVG handles comfortably,
 * and far simpler than maintaining a redraw loop.
 *
 * Geometry is stored in grid units, so this component converts on the way in
 * (pointer → grid, with optional snapping) and on the way out (grid → image
 * pixels for rendering). Nothing outside the editor sees pixel coordinates.
 */
export default function VttCanvas({
  imageUrl,
  pixelWidth,
  pixelHeight,
  cellPx,
  offset,
  doc,
  tool,
  snap,
  showGrid,
  draft,
  selection,
  hideLights,
  onCanvasClick,
  onCanvasDoubleClick,
  onPointerMove,
  viewportRef,
}) {
  const containerRef = useRef(null)
  const imageSize = useMemo(
    () => ({ width: pixelWidth, height: pixelHeight }),
    [pixelWidth, pixelHeight]
  )
  const viewport = useViewport(containerRef, imageSize)
  const { view, toImage, zoomAt, startPan, movePan, endPan, isPanning } = viewport

  // Handed up so the toolbar's zoom/fit buttons drive the same viewport.
  useEffect(() => {
    if (viewportRef) viewportRef.current = viewport
  })

  const onWheel = useCallback(
    (e) => {
      e.preventDefault()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY)
    },
    [zoomAt]
  )

  // Non-passive so preventDefault actually stops the page scrolling behind it;
  // React's own onWheel is passive and cannot.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  /** Pointer position as a grid-space point, with the active snap applied. */
  const toGridPoint = useCallback(
    (clientX, clientY) => {
      const img = toImage(clientX, clientY)
      const g = imageToGrid(img, cellPx, offset)
      if (snap === 'grid') return snapToGrid(g)
      if (snap === 'half') return snapToHalf(g)
      return { x: round4(g.x), y: round4(g.y) }
    },
    [toImage, cellPx, offset, snap]
  )

  const handleDown = (e) => {
    if (e.button !== 0) {
      startPan(e.clientX, e.clientY)
      return
    }
    onCanvasClick?.(toGridPoint(e.clientX, e.clientY), e)
  }

  const handleMove = (e) => {
    if (movePan(e.clientX, e.clientY)) return
    onPointerMove?.(toGridPoint(e.clientX, e.clientY))
  }

  const toPx = useCallback((pt) => gridToImage(pt, cellPx, offset), [cellPx, offset])
  // Dimmer than the calibration overlay: here the grid is a reference while
  // drawing, not the thing being judged.
  const gridStyle = gridOverlayStyle(cellPx, offset, view.scale, 0.35)
  const path = useCallback(
    (points) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toPx(p).x} ${toPx(p).y}`).join(' '),
    [toPx]
  )

  const isSelected = (key, index) => selection?.key === key && selection?.index === index

  return (
    <div
      ref={containerRef}
      data-testid="vtt-canvas"
      onMouseDown={handleDown}
      onMouseMove={handleMove}
      onMouseUp={endPan}
      onMouseLeave={endPan}
      onDoubleClick={(e) => onCanvasDoubleClick?.(toGridPoint(e.clientX, e.clientY), e)}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        background: 'var(--bg-deep)',
        cursor: isPanning ? 'grabbing' : tool === TOOL_SELECT ? 'default' : 'crosshair',
      }}
    >
      <div
        style={{
          position: 'absolute',
          transformOrigin: '0 0',
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          width: pixelWidth,
          height: pixelHeight,
        }}
      >
        <img
          src={imageUrl}
          alt=""
          width={pixelWidth}
          height={pixelHeight}
          draggable={false}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />

        {showGrid && gridStyle && (
          <div
            data-testid="canvas-grid"
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...gridStyle }}
          />
        )}

        <svg
          data-testid="vtt-overlay"
          width={pixelWidth}
          height={pixelHeight}
          viewBox={`0 0 ${pixelWidth} ${pixelHeight}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
        >
          {/* Lights first, so their glow sits under the geometry rather than
              washing the walls out. */}
          {!hideLights &&
            doc.lights.map((light, i) => {
              const c = toPx(light.position)
              // range is in grid squares; a light's reach on screen is that
              // many cells, which is why it scales with cellPx and not zoom.
              const r = Math.max(1, light.range * cellPx)
              return (
                <g key={`light-${i}`} data-testid="light-marker">
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={r}
                    fill={argbToCss(light.color, 0.22 * Math.min(1, light.intensity || 1))}
                    stroke={argbToCss(light.color, 0.5)}
                    strokeWidth={2 / view.scale}
                  />
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r={Math.max(3, 7 / view.scale)}
                    fill={argbToCss(light.color, 1)}
                    stroke={isSelected('lights', i) ? '#ffffff' : 'rgba(0,0,0,0.6)'}
                    strokeWidth={(isSelected('lights', i) ? 3 : 1.5) / view.scale}
                  />
                </g>
              )
            })}

          {['line_of_sight', 'objects_line_of_sight'].map((key) =>
            doc[key].map((line, i) => (
              <path
                key={`${key}-${i}`}
                data-testid={key === 'line_of_sight' ? 'wall-path' : 'object-path'}
                d={path(line)}
                fill="none"
                stroke={isSelected(key, i) ? '#ffffff' : LAYER_STYLE[key].stroke}
                // Stroke width is divided by the zoom so a wall stays the same
                // thickness on screen: at 8x zoom an unscaled 3px stroke would
                // cover the map detail the user is trying to trace.
                strokeWidth={LAYER_STYLE[key].width / view.scale}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))
          )}

          {doc.portals.map((portal, i) => {
            const a = toPx(portal.bounds[0])
            const b = toPx(portal.bounds[1])
            return (
              <line
                key={`portal-${i}`}
                data-testid="portal-line"
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isSelected('portals', i) ? '#ffffff' : LAYER_STYLE.portals.stroke}
                strokeWidth={LAYER_STYLE.portals.width / view.scale}
                strokeLinecap="round"
                // A window (closed: false) is dashed, so door and window are
                // distinguishable without relying on colour alone.
                strokeDasharray={portal.closed ? undefined : `${8 / view.scale} ${6 / view.scale}`}
              />
            )
          })}

          {/* The shape being drawn right now, including the rubber-band segment
              to the cursor so the user can see where the next click lands. */}
          {draft?.points?.length > 0 && (
            <>
              <path
                data-testid="draft-path"
                d={path(draft.cursor ? [...draft.points, draft.cursor] : draft.points)}
                fill="none"
                stroke="#ffffff"
                strokeWidth={2.5 / view.scale}
                strokeDasharray={`${6 / view.scale} ${4 / view.scale}`}
                strokeLinecap="round"
              />
              {draft.points.map((p, i) => {
                const c = toPx(p)
                return (
                  <circle
                    key={`draft-pt-${i}`}
                    cx={c.x}
                    cy={c.y}
                    r={4 / view.scale}
                    fill="#ffffff"
                    stroke="rgba(0,0,0,0.6)"
                    strokeWidth={1 / view.scale}
                  />
                )
              })}
            </>
          )}

          {/* Where the next click will land, snapped. Without it, snapping is
              invisible until after the click has already been committed. */}
          {draft?.cursor &&
            (tool === TOOL_PORTAL || tool === TOOL_LIGHT || POLYLINE_TOOLS.has(tool)) && (
              <circle
                data-testid="snap-indicator"
                cx={toPx(draft.cursor).x}
                cy={toPx(draft.cursor).y}
                r={5 / view.scale}
                fill="none"
                stroke="var(--gold, #d4af37)"
                strokeWidth={2 / view.scale}
              />
            )}
        </svg>
      </div>
    </div>
  )
}
