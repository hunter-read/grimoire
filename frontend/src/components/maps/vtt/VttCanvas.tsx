import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gridToImage, imageToGrid, round4, snapToGrid, snapToHalf } from './geometry'
import { collectSegments, computeVisibility, litRegions, polygonPath } from './visibility'
import { argbToAlpha, argbToCss } from './color'
import { LAYER_STYLE, POLYLINE_TOOLS, PORTAL_TOOLS, TOOL_LIGHT, TOOL_SELECT } from './tools'
import useViewport from './useViewport'
import { gridOverlayStyle } from './gridOverlay'
import { LIGHT_MARKER_PX } from './hitTest'

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
    // Selecting deliberately ignores the snap. Snapping exists so a *drawn*
    // point lands on a grid line, but it rounds a click to the nearest
    // intersection — which throws away exactly the precision a selection
    // needs. With grid snap on, every click inside a cell collapsed to the
    // same corner, so two walls a tenth of a cell apart, or a light beside a
    // wall, resolved to one identical point and only ever selected whichever
    // feature was nearest *that corner*. No amount of zooming could separate
    // them, because the coordinate reaching the hit test never changed.
    const free = tool === TOOL_SELECT || e.altKey
    onCanvasClick?.(toGridPoint(e.clientX, e.clientY, free), e)
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
  const hasVision = preview?.vision !== false

  // What the token could see if everywhere were lit — bounded only by walls.
  // Sight itself is no longer capped by a radius: eyes are not limited to a
  // number of squares, light and walls are what limit them. The radius that
  // used to live here is now night vision, which is the thing that genuinely
  // has a distance.
  const sightPolygon = useMemo(() => {
    if (!previewOn || !preview.token || !hasVision) return null
    return computeVisibility(preview.token, segments, 0)
  }, [previewOn, preview?.token, hasVision, segments])

  // The regions that are actually lit (or seen by darkvision). Each is
  // clipped to `sightPolygon` when drawn, so nothing shows through a wall.
  const regions = useMemo(() => {
    if (!previewOn || !preview.token) return []
    return litRegions({
      token: preview.token,
      lights: doc.lights,
      segments,
      nightVision: preview.nightVision ? preview.nightVisionRange : 0,
      tokenLight: preview.lightRange,
      hasVision,
    })
  }, [
    previewOn,
    preview?.token,
    preview?.nightVision,
    preview?.nightVisionRange,
    preview?.lightRange,
    hasVision,
    doc.lights,
    segments,
  ])

  // Ambient light decides how dark "unlit" is. A map authored with moonlight
  // ambient should not preview as pitch black, and one authored pitch black
  // should not preview as readable — the setting exists precisely to make
  // that choice, so the preview has to honour it or it is previewing a
  // different map than the one being exported.
  const ambientAlpha = argbToAlpha(doc.environment?.ambient_light ?? '00000000')
  // Ambient never fully erases the shroud: at strength 1 the preview would be
  // indistinguishable from the preview being off, and the GM would think it
  // had broken. It floors at a visible dimming instead.
  const shroudAlpha = Math.max(0.25, 0.88 * (1 - ambientAlpha))
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
              geometry stays legible on top of it.

              The shroud is punched through by the *union* of everything that
              reveals ground — night vision, the carried torch, and the area
              each placed light falls on — with the whole union clipped to the
              token's line of sight. Composing it this way is what makes a lit
              room across the map visible from the doorway, instead of the map
              staying dark until the token stands in the light. */}
          {previewOn && (
            <>
              <defs>
                {/* The token's line of sight, used to clip every reveal and
                    every glow below. SVG masks have no intersection operator,
                    so applying this to the group that draws the union of lit
                    regions is how the two are combined. */}
                <mask id="vtt-preview-sight">
                  {sightPolygon && <path d={polygonPath(sightPolygon.map(toPx))} fill="#ffffff" />}
                </mask>
                {/* The darkness, with everything lit-and-visible cut out of
                    it: white stays dark, black punches a hole. */}
                <mask id="vtt-visible-mask">
                  <rect x="0" y="0" width={pixelWidth} height={pixelHeight} fill="#ffffff" />
                  <g mask="url(#vtt-preview-sight)">
                    {regions.map((region, i) => (
                      <path
                        key={`reveal-${i}`}
                        data-testid="preview-reveal"
                        data-kind={region.kind}
                        d={polygonPath(region.polygon.map(toPx))}
                        fill="#000000"
                      />
                    ))}
                  </g>
                </mask>
              </defs>

              <rect
                data-testid="preview-shroud"
                x="0"
                y="0"
                width={pixelWidth}
                height={pixelHeight}
                // Darkness is driven by the authored ambient light rather than
                // fixed, so the preview shows the map that will actually be
                // exported. Never fully opaque: the GM is still working on the
                // artwork underneath.
                fill={`rgba(0, 0, 0, ${shroudAlpha})`}
                mask="url(#vtt-visible-mask)"
              />

              {/* The warm tint each light casts, over the ground it reaches.
                  Drawn per light rather than as one wash so two lights of
                  different colours read as two lights, and clipped to sight so
                  a lamp around a corner does not glow through the wall. */}
              <g mask="url(#vtt-preview-sight)">
                {regions.map((region, i) => {
                  if (region.kind === 'night') return null
                  const fill =
                    region.kind === 'token-light'
                      ? 'rgba(255, 226, 170, 0.16)'
                      : argbToCss(
                          region.light.color,
                          0.18 * Math.min(1, region.light.intensity || 1)
                        )
                  return (
                    <path
                      key={`glow-${i}`}
                      data-testid={
                        region.kind === 'token-light' ? 'preview-token-light' : 'preview-lit-light'
                      }
                      d={polygonPath(region.polygon.map(toPx))}
                      fill={fill}
                    />
                  )
                })}
              </g>

              {/* Night vision reads as a cool wash, the way VTTs tint
                  darkvision, so a GM can tell at a glance which ground is
                  genuinely lit and which is only visible because this token
                  happens to see in the dark. */}
              {regions
                .filter((r) => r.kind === 'night')
                .map((region, i) => (
                  <path
                    key={`night-${i}`}
                    data-testid="preview-night-vision"
                    d={polygonPath(region.polygon.map(toPx))}
                    fill="rgba(120, 170, 200, 0.10)"
                    mask="url(#vtt-preview-sight)"
                  />
                ))}
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
                    // Drawn from the same constant the hit test uses, so the
                    // dot you can see and the dot you can click are the same
                    // circle at every zoom level.
                    r={LIGHT_MARKER_PX / view.scale}
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
