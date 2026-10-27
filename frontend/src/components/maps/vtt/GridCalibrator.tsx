import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCrosshair, LuMaximize, LuZoomIn, LuZoomOut } from 'react-icons/lu'
import { gridDimensions, round4 } from './geometry'
import useViewport from './useViewport'
import { gridOverlayStyle } from './gridOverlay'
import Field from './Field'
import NumberNudge from './NumberNudge'
import { btnStyle, iconBtnStyle, inputStyle, sectionTitleStyle } from './ui'

/**
 * Step 1 of the Universal VTT editor: confirm the grid before drawing on it.
 *
 * Everything downstream is expressed in grid units, so a wrong cell size does
 * not merely look wrong — it silently misplaces every wall and light in the
 * exported file. This step puts the *detected* grid on screen as an overlay so
 * the user can see whether it lines up, and gives them two ways to correct it:
 * stating how many cells the map is across, which is how most people already
 * know their grid, or nudging the cell size and offset directly.
 *
 * Zoom matters here: at fit-to-window on a 5000px map, one screen pixel spans
 * several image pixels, so judging whether the overlay lines up needs a closer
 * look than the fitted view gives.
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
  const { view, fit, zoomAt, zoomBy, startPan, movePan, endPan, isPanning } = useViewport(
    containerRef,
    imageSize
  )

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

      {/* Canvas and controls side by side, matching the drawing phase's
          layout. Keeping the panel in the same place across both steps means
          confirming the grid and then drawing on it do not shuffle the page
          out from under the user — and a tall narrow column suits these
          grouped controls better than a wrapping bar did. */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          ref={containerRef}
          data-testid="calibrator-canvas"
          onMouseDown={(e) => startPan(e.clientX, e.clientY)}
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
            cursor: isPanning ? 'grabbing' : 'grab',
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
          </div>
        </div>

        {/* Same width, border and padding as the drawing phase's sidebar, so
            the two steps present one panel that changes contents rather than
            two panels in different places. */}
        <div
          style={{
            width: 290,
            flexShrink: 0,
            overflowY: 'auto',
            padding: 16,
            borderLeft: '1px solid var(--border)',
            background: 'var(--bg-panel)',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {/* Route 1 — say how big the map is. The most direct way most people
              know their grid, and it redraws the overlay as you type. */}
          <div>
            <div style={sectionTitleStyle}>{t('maps.vtt.calibrate.byCount')}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label={t('maps.vtt.calibrate.cellsAcross')} style={{ flex: 1, minWidth: 0 }}>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={dims.width || ''}
                  onChange={(e) => setFromCellCount('x', e.target.value)}
                  aria-label={t('maps.vtt.calibrate.cellsAcross')}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                />
              </Field>
              <Field label={t('maps.vtt.calibrate.cellsDown')} style={{ flex: 1, minWidth: 0 }}>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={dims.height || ''}
                  onChange={(e) => setFromCellCount('y', e.target.value)}
                  aria-label={t('maps.vtt.calibrate.cellsDown')}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                />
              </Field>
            </div>
          </div>

          {/* Route 2 — the numbers themselves, for walking an almost-right
              grid into place. */}
          <div>
            <div style={sectionTitleStyle}>{t('maps.vtt.calibrate.manual')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label={t('maps.vtt.calibrate.cellPx')}>
                <NumberNudge
                  value={cellPx}
                  onChange={(v) => onChange(Math.max(1, v), offset)}
                  label={t('maps.vtt.calibrate.cellPx')}
                />
              </Field>
              <div style={{ display: 'flex', gap: 10 }}>
                <Field label={t('maps.vtt.calibrate.offsetX')} style={{ flex: 1, minWidth: 0 }}>
                  <NumberNudge
                    value={offset.x}
                    onChange={(v) => onChange(cellPx, { ...offset, x: v })}
                    label={t('maps.vtt.calibrate.offsetX')}
                  />
                </Field>
                <Field label={t('maps.vtt.calibrate.offsetY')} style={{ flex: 1, minWidth: 0 }}>
                  <NumberNudge
                    value={offset.y}
                    onChange={(v) => onChange(cellPx, { ...offset, y: v })}
                    label={t('maps.vtt.calibrate.offsetY')}
                  />
                </Field>
              </div>
            </div>
          </div>

          {/* The result and the way out, pinned to the bottom of the column:
              this is the step's conclusion, so it sits below the controls that
              lead to it however tall they grow. */}
          <div style={{ marginTop: 'auto', paddingTop: 4 }}>
            <div
              style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}
              data-testid="calibrator-dims"
            >
              {t('maps.vtt.calibrate.result', { width: dims.width, height: dims.height })}
            </div>
            <button
              type="button"
              onClick={onConfirm}
              style={{
                ...btnStyle,
                width: '100%',
                justifyContent: 'center',
                borderColor: 'var(--gold)',
                color: 'var(--gold)',
              }}
            >
              {t('maps.vtt.calibrate.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
