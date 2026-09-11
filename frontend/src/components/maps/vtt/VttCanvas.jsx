import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gridToImage, imageToGrid, round4, snapToGrid, snapToHalf } from './geometry'
import { collectSegments, computeVisibility, polygonPath, visibleLights } from './visibility'
import { argbToCss } from './color'
import { LAYER_STYLE, POLYLINE_TOOLS, PORTAL_TOOLS, TOOL_LIGHT, TOOL_SELECT } from './tools'
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
  preview,
  onCanvasClick,
  onCanvasDoubleClick,
  onPointerMove,
  onTokenMove,
  viewportRef,
}) {
  const containerRef = useRef(null)
  // Dragging the preview token. Held here rather than lifted: it lasts exactly
  // as long as one gesture on this surface and nothing above needs to know.
  const [draggingToken, setDraggingToken] = useState(false)
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

  /**
   * Pointer position as a grid-space point, with the active snap applied.
   *
   * Holding Alt suspends snapping for that one point. A room is usually drawn
   * on the grid and then has one corner that genuinely is not — a canted wall,
   * a doorway half a cell off — and switching the snap mode to place it means
   * remembering to switch back before the next click. The modifier scopes the
   * exception to exactly the point that needs it.
   */
  const toGridPoint = useCallback(
    (clientX, clientY, freeOverride = false) => {
      const img = toImage(clientX, clientY)
      const g = imageToGrid(img, cellPx, offset)
      if (freeOverride) return { x: round4(g.x), y: round4(g.y) }
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
    onCanvasClick?.(toGridPoint(e.clientX, e.clientY, e.altKey), e)
  }

  const handleMove = (e) => {
    if (draggingToken) {
      // Free placement while dragging: a token is a viewing position, not a
      // wall, so forcing it onto intersections would make the preview coarser
      // than the thing it is previewing.
      const img = toImage(e.clientX, e.clientY)
      onTokenMove?.(imageToGrid(img, cellPx, offset))
      return
    }
    if (movePan(e.clientX, e.clientY)) return
    // The preview dot has to honour the modifier too, or the point lands
    // somewhere other than where it was shown.
    onPointerMove?.(toGridPoint(e.clientX, e.clientY, e.altKey), e.altKey)
  }

  const endDrag = () => {
    setDraggingToken(false)
    endPan()
  }

  const toPx = useCallback((pt) => gridToImage(pt, cellPx, offset), [cellPx, offset])

  // The player view. Recomputed only when the token moves or the geometry
  // changes — memoised because it runs on every render otherwise, and a pan is
  // a render. Everything here is in grid units until it reaches `toPx`.
  const previewOn = !!preview?.enabled
  const segments = useMemo(() => (previewOn ? collectSegments(doc) : []), [previewOn, doc])
  const sightPolygon = useMemo(() => {
    if (!previewOn || !preview.token) return null
    return computeVisibility(preview.token, segments, preview.sightRange)
  }, [previewOn, preview?.token, preview?.sightRange, segments])
  const litLights = useMemo(() => {
    if (!previewOn || !preview.token) return []
    return visibleLights(preview.token, doc.lights, segments)
  }, [previewOn, preview?.token, doc.lights, segments])
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
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onDoubleClick={(e) => onCanvasDoubleClick?.(toGridPoint(e.clientX, e.clientY, e.altKey), e)}
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
          {/* The player view, drawn under everything else so the authored
              geometry stays legible on top of it. */}
          {previewOn && sightPolygon && (
            <>
              <defs>
                <mask id="vtt-visible-mask">
                  {/* White shows the darkness, black punches the visible area
                      out of it — so the room the token is in stays bright and
                      everything beyond a wall is covered. */}
                  <rect x="0" y="0" width={pixelWidth} height={pixelHeight} fill="#ffffff" />
                  <path d={polygonPath(sightPolygon.map(toPx))} fill="#000000" />
                </mask>
              </defs>
              <rect
                data-testid="preview-shroud"
                x="0"
                y="0"
                width={pixelWidth}
                height={pixelHeight}
                // Not fully opaque: a GM still needs to see the map they are
                // working on underneath, and a real VTT shows explored-but-
                // unseen area dimmed rather than erased.
                fill="rgba(0, 0, 0, 0.82)"
                mask="url(#vtt-visible-mask)"
              />

              {/* The token's own light, and each placed light that actually
                  reaches it — both clipped to what is visible, so a lamp around
                  a corner does not glow through the wall hiding it. */}
              <g mask="url(#vtt-preview-lit)">
                {preview.lightRange > 0 && (
                  <circle
                    data-testid="preview-token-light"
                    cx={toPx(preview.token).x}
                    cy={toPx(preview.token).y}
                    r={preview.lightRange * cellPx}
                    fill="rgba(255, 226, 170, 0.16)"
                  />
                )}
                {litLights.map((light, i) => (
                  <circle
                    key={`lit-${i}`}
                    data-testid="preview-lit-light"
                    cx={toPx(light.position).x}
                    cy={toPx(light.position).y}
                    r={Math.max(1, light.range * cellPx)}
                    fill={argbToCss(light.color, 0.18 * Math.min(1, light.intensity || 1))}
                  />
                ))}
              </g>
              <defs>
                <mask id="vtt-preview-lit">
                  <path d={polygonPath(sightPolygon.map(toPx))} fill="#ffffff" />
                </mask>
              </defs>
            </>
          )}

          {/* Lights first, so their glow sits under the geometry rather than
              washing the walls out. Hidden while previewing: the preview draws
              only the lights that actually reach the token, and the authoring
              circles would contradict it. */}
          {!previewOn &&
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

          {/* The token last, so it sits above the shroud and the geometry —
              it is the thing being moved, and losing it under a wall would
              make dragging guesswork. */}
          {previewOn && preview.token && (
            <g
              data-testid="preview-token"
              onMouseDown={(e) => {
                // Claim the drag before the canvas treats it as a draw/pan.
                e.stopPropagation()
                setDraggingToken(true)
              }}
              style={{ cursor: 'grab', pointerEvents: 'auto' }}
            >
              <circle
                cx={toPx(preview.token).x}
                cy={toPx(preview.token).y}
                r={Math.max(4, cellPx * 0.32)}
                fill="rgba(90, 170, 255, 0.85)"
                stroke="#ffffff"
                strokeWidth={2 / view.scale}
              />
            </g>
          )}

          {/* Where the next click will land, snapped. Without it, snapping is
              invisible until after the click has already been committed.
              Turns white while Alt suspends snapping, so the override is
              visible before the click rather than only in its result. */}
          {draft?.cursor &&
            (PORTAL_TOOLS.has(tool) || tool === TOOL_LIGHT || POLYLINE_TOOLS.has(tool)) && (
              <circle
                data-testid="snap-indicator"
                data-free={draft.free ? 'true' : undefined}
                cx={toPx(draft.cursor).x}
                cy={toPx(draft.cursor).y}
                r={5 / view.scale}
                fill="none"
                stroke={draft.free ? '#ffffff' : 'var(--gold, #d4af37)'}
                strokeWidth={2 / view.scale}
                strokeDasharray={draft.free ? `${3 / view.scale} ${3 / view.scale}` : undefined}
              />
            )}
        </svg>
      </div>
    </div>
  )
}
