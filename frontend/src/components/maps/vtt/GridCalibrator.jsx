import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCrosshair, LuMaximize, LuRotateCcw, LuZoomIn, LuZoomOut } from 'react-icons/lu'
import { calibrateFromPoints, gridDimensions, round4 } from './geometry'
import useViewport from './useViewport'
import { gridOverlayStyle } from './gridOverlay'
import Field from './Field'
import NumberNudge from './NumberNudge'
import { btnStyle, groupLabelStyle, iconBtnStyle, inputStyle } from './ui'

/**
 * Step 1 of the Universal VTT editor: confirm the grid before drawing on it.
 *
 * Everything downstream is expressed in grid units, so a wrong cell size does
 * not merely look wrong — it silently misplaces every wall and light in the
 * exported file. This step puts the *detected* grid on screen as an overlay so
 * the user can see whether it lines up, and lets them correct it by clicking
 * intersections they can actually see rather than by typing numbers.
 *
 * Picking two intersections several cells apart divides the user's aiming error
 * by that many cells, which is what makes this more accurate than counting one
 * square — hence the "how many cells apart" input rather than assuming adjacent
 * picks. Zoom exists for the same reason: at fit-to-window on a 5000px map, one
 * screen pixel spans several image pixels.
 */
export default function GridCalibrator({
  imageUrl,
  pixelWidth,
  pixelHeight,
  cellPx,
  offset,
  onChange,
  onConfirm,
}) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const imageSize = useMemo(
    () => ({ width: pixelWidth, height: pixelHeight }),
    [pixelWidth, pixelHeight]
  )
  const { view, fit, toImage, zoomAt, zoomBy, startPan, movePan, endPan, isPanning } = useViewport(
    containerRef,
    imageSize
  )

  // Intersections the user has clicked, in image pixels.
  const [picks, setPicks] = useState([])
  // How many cells apart the picked extremes are, when calibrating from picks.
  const [spanX, setSpanX] = useState('')
  const [spanY, setSpanY] = useState('')

  const dims = gridDimensions(pixelWidth, pixelHeight, cellPx, offset)

  /**
   * Set the cell size from a whole-map cell count.
   *
   * Typing "the map is 30 cells across" is the most direct way most people
   * know their grid, and it redraws the overlay immediately — so the count
   * boxes are a live control on the grid, not just an input to the pick-based
   * calibration. The offset is left alone: it is a separate correction, and
   * resetting it here would undo nudging the user had already done.
   */
  const setFromCellCount = (axis, raw) => {
    const count = Number(raw)
    if (!(count > 0)) return
    const span = axis === 'x' ? pixelWidth - offset.x : pixelHeight - offset.y
    onChange(Math.max(1, round4(span / count)), offset)
  }

  const onWheel = useCallback(
    (e) => {
      e.preventDefault()
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY)
    },
    [zoomAt]
  )

  // Wheel zoom is registered non-passively: React's onWheel is passive, so
  // preventDefault there is ignored and the page scrolls behind the canvas.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const addPick = (e) => {
    // Middle/right drag pans; only a plain left click places a point.
    if (e.button !== 0) return
    const pt = toImage(e.clientX, e.clientY)
    if (pt.x < 0 || pt.y < 0 || pt.x > pixelWidth || pt.y > pixelHeight) return
    setPicks((p) => [...p, { x: round4(pt.x), y: round4(pt.y) }].slice(-6))
  }

  const apply = () => {
    const result = calibrateFromPoints(picks, Number(spanX) || 0, Number(spanY) || 0)
    if (!result) return
    onChange(result.cellPx, result.offset)
    setPicks([])
  }

  const canApply = picks.length >= 2 && (Number(spanX) > 0 || Number(spanY) > 0)

  // Line width is tied to the zoom so the grid stays one screen pixel wide —
  // see gridOverlay.js for why that and the gradient choice both matter.
  const gridStyle = gridOverlayStyle(cellPx, offset, view.scale)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '8px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}
      >
        <LuCrosshair size={15} aria-hidden="true" style={{ color: 'var(--gold)' }} />
        <span style={{ fontSize: 13 }}>{t('maps.vtt.calibrate.instructions')}</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.3)}
          style={iconBtnStyle}
          aria-label={t('maps.vtt.zoomOut')}
        >
          <LuZoomOut size={15} />
        </button>
        <span
          style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 44, textAlign: 'center' }}
        >
          {Math.round(view.scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => zoomBy(1.3)}
          style={iconBtnStyle}
          aria-label={t('maps.vtt.zoomIn')}
        >
          <LuZoomIn size={15} />
        </button>
        <button type="button" onClick={fit} style={iconBtnStyle} aria-label={t('maps.vtt.fit')}>
          <LuMaximize size={15} />
        </button>
      </div>

      <div
        ref={containerRef}
        data-testid="calibrator-canvas"
        onMouseDown={(e) => {
          if (e.button === 0) addPick(e)
          else startPan(e.clientX, e.clientY)
        }}
        onMouseMove={(e) => movePan(e.clientX, e.clientY)}
        onMouseUp={endPan}
        onMouseLeave={endPan}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--bg-deep)',
          cursor: isPanning ? 'grabbing' : 'crosshair',
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
          {gridStyle && (
            <div
              data-testid="grid-overlay"
              aria-hidden="true"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...gridStyle }}
            />
          )}
          {picks.map((p, i) => (
            <div
              key={`${p.x}-${p.y}-${i}`}
              data-testid="calibration-pick"
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: p.x,
                top: p.y,
                // Counter-scaled so the marker stays the same size on screen at
                // any zoom — the point of zooming is to aim precisely, and a
                // marker that grows with the image would hide what it marks.
                transform: `translate(-50%, -50%) scale(${1 / view.scale})`,
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '2px solid var(--gold)',
                background: 'var(--overlay, rgba(0,0,0,0.4))',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          flexWrap: 'wrap',
          padding: '10px 14px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-panel)',
        }}
      >
        {/* Route 1 — say how big the map is. The most direct way most people
            know their grid, and it redraws the overlay as you type. */}
        <span style={groupLabelStyle}>{t('maps.vtt.calibrate.byCount')}</span>
        <Field label={t('maps.vtt.calibrate.cellsAcross')}>
          <input
            type="number"
            min="0"
            step="0.25"
            value={dims.width || ''}
            onChange={(e) => setFromCellCount('x', e.target.value)}
            aria-label={t('maps.vtt.calibrate.cellsAcross')}
            style={{ ...inputStyle, width: 78 }}
          />
        </Field>
        <Field label={t('maps.vtt.calibrate.cellsDown')}>
          <input
            type="number"
            min="0"
            step="0.25"
            value={dims.height || ''}
            onChange={(e) => setFromCellCount('y', e.target.value)}
            aria-label={t('maps.vtt.calibrate.cellsDown')}
            style={{ ...inputStyle, width: 78 }}
          />
        </Field>

        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />

        {/* Route 2 — pick two intersections. More accurate on a map whose grid
            does not divide the image evenly, since the error is spread over
            however many cells the picks span. */}
        <span style={groupLabelStyle}>{t('maps.vtt.calibrate.byPicks')}</span>
        <Field label={t('maps.vtt.calibrate.spanX')}>
          <input
            type="number"
            min="0"
            value={spanX}
            onChange={(e) => setSpanX(e.target.value)}
            aria-label={t('maps.vtt.calibrate.spanX')}
            style={{ ...inputStyle, width: 70 }}
          />
        </Field>
        <Field label={t('maps.vtt.calibrate.spanY')}>
          <input
            type="number"
            min="0"
            value={spanY}
            onChange={(e) => setSpanY(e.target.value)}
            aria-label={t('maps.vtt.calibrate.spanY')}
            style={{ ...inputStyle, width: 70 }}
          />
        </Field>
        <button type="button" onClick={apply} disabled={!canApply} style={btnStyle}>
          {t('maps.vtt.calibrate.apply', { count: picks.length })}
        </button>
        <button
          type="button"
          onClick={() => setPicks([])}
          disabled={picks.length === 0}
          style={btnStyle}
        >
          <LuRotateCcw size={13} aria-hidden="true" /> {t('maps.vtt.calibrate.clearPicks')}
        </button>

        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />

        <Field label={t('maps.vtt.calibrate.cellPx')}>
          <NumberNudge
            value={cellPx}
            onChange={(v) => onChange(Math.max(1, v), offset)}
            label={t('maps.vtt.calibrate.cellPx')}
          />
        </Field>
        <Field label={t('maps.vtt.calibrate.offsetX')}>
          <NumberNudge
            value={offset.x}
            onChange={(v) => onChange(cellPx, { ...offset, x: v })}
            label={t('maps.vtt.calibrate.offsetX')}
          />
        </Field>
        <Field label={t('maps.vtt.calibrate.offsetY')}>
          <NumberNudge
            value={offset.y}
            onChange={(v) => onChange(cellPx, { ...offset, y: v })}
            label={t('maps.vtt.calibrate.offsetY')}
          />
        </Field>

        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }} data-testid="calibrator-dims">
          {t('maps.vtt.calibrate.result', { width: dims.width, height: dims.height })}
        </div>
        <button
          type="button"
          onClick={onConfirm}
          style={{ ...btnStyle, borderColor: 'var(--gold)', color: 'var(--gold)' }}
        >
          {t('maps.vtt.calibrate.confirm')}
        </button>
      </div>
    </div>
  )
}
