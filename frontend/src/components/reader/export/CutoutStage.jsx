import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderWidthFor } from '../../../hooks/useReaderZoom'
import Spinner from '../../Spinner'
import { PAGE_WIDTH } from '../pageRender'
import CutoutBox from './CutoutBox'
import { boxFromDrag, fromStage, isTiny, moveBox, resizeBox, toStage } from './cutoutGeometry'
import { TOOLS } from './usePageExport'

// Breathing room around the page, so a box can be started just outside its edge.
const PAD = 28
const NUDGE = 0.004
const NUDGE_FAR = 0.02

const clampPoint = (p) => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) })

/**
 * The page (or spread) as a drawing surface for cut-outs (issue #207).
 *
 * Takes the place of the reader's page while the Cut out tab is open. It lays
 * the pages out from their real point sizes - the same frame the server renders
 * in - and draws every cut-out that falls on them. Dragging on empty page draws
 * a new one with the chosen tool; dragging a box moves it; its handles resize
 * it. Holding Shift keeps a rectangle square.
 *
 * Pointer capture is taken on the frame, so a drag that leaves the page keeps
 * tracking instead of dropping the box mid-gesture. Edits are kept local while
 * a pointer is down and committed once on release, so the panel list (and its
 * thumbnails) update once per gesture rather than on every pixel.
 */
export default function CutoutStage({ exporter, pageUrl, zoom = 1, getAlt }) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const frameRef = useRef(null)
  const boxRefs = useRef({})
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [drag, setDrag] = useState(null)
  const layout = exporter.stageLayout

  useEffect(() => {
    const node = containerRef.current
    if (!node) return undefined
    const measure = () => setArea({ width: node.clientWidth, height: node.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  // Keep keyboard focus on the selected box, so it can be nudged or deleted
  // straight after it is drawn or picked from the list.
  useEffect(() => {
    const node = boxRefs.current[exporter.activeId]
    if (node && document.activeElement !== node && !drag) node.focus({ preventScroll: true })
  }, [exporter.activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const containerStyle = {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    background: 'var(--bg-deep)',
    position: 'relative',
  }

  // The container is the same element before and after the page sizes arrive,
  // so the size observer above keeps watching the node that is on screen.
  if (!layout) {
    return (
      <div
        ref={containerRef}
        data-testid="cutout-stage"
        style={{ ...containerStyle, alignItems: 'center', justifyContent: 'center' }}
      >
        <Spinner size={28} />
      </div>
    )
  }

  const aspect = layout.width / layout.height
  const fit = Math.max(
    0.01,
    Math.min((area.width - PAD * 2) / layout.width, (area.height - PAD * 2) / layout.height)
  )
  const frameW = layout.width * fit * zoom
  const frameH = layout.height * fit * zoom
  const renderWidth = renderWidthFor(PAGE_WIDTH, zoom)
  const toolSpec = TOOLS[exporter.tool]

  const pointFrom = (e) => {
    const r = frameRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const capture = (e) => {
    try {
      frameRef.current?.setPointerCapture?.(e.pointerId)
    } catch {
      // A synthetic or already-released pointer cannot be captured; the drag
      // still works while the pointer stays over the page.
    }
  }

  const startDraw = (e) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    capture(e)
    const p = clampPoint(pointFrom(e))
    setDrag({ mode: 'draw', start: p, box: { ...p, w: 0, h: 0 } })
  }

  const startMove = (cutout, box) => (e) => {
    if (e.button !== undefined && e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    capture(e)
    exporter.setActiveId(cutout.id)
    setDrag({ mode: 'move', id: cutout.id, start: pointFrom(e), origin: box, box, moved: false })
  }

  const startResize = (cutout, box) => (e, handle) => {
    e.stopPropagation()
    e.preventDefault()
    capture(e)
    exporter.setActiveId(cutout.id)
    setDrag({
      mode: 'resize',
      id: cutout.id,
      handle,
      locked: cutout.locked,
      start: pointFrom(e),
      origin: box,
      box,
      moved: false,
    })
  }

  const onPointerMove = (e) => {
    if (!drag) return
    const p = pointFrom(e)
    const dx = p.x - drag.start.x
    const dy = p.y - drag.start.y
    let box
    if (drag.mode === 'draw') {
      box = boxFromDrag(drag.start, clampPoint(p), {
        square: toolSpec.locked || e.shiftKey,
        aspect,
      })
    } else if (drag.mode === 'move') {
      box = moveBox(drag.origin, dx, dy)
    } else {
      box = resizeBox(drag.origin, drag.handle, dx, dy, {
        square: drag.locked || e.shiftKey,
        aspect,
      })
    }
    setDrag({ ...drag, box, moved: true })
  }

  const onPointerUp = () => {
    if (!drag) return
    if (drag.mode === 'draw') {
      if (isTiny(drag.box)) exporter.setActiveId(null)
      else exporter.addCutout({ ...fromStage(drag.box, layout), ...toolSpec })
    } else if (drag.moved) {
      exporter.updateCutout(drag.id, fromStage(drag.box, layout))
    }
    setDrag(null)
  }

  const onBoxKeyDown = (cutout, box) => (e) => {
    if (e.key === 'Tab') return
    const step = e.shiftKey ? NUDGE_FAR : NUDGE
    const arrows = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    // Everything else stays inside the box: the reader turns pages on the
    // arrow keys and toggles panels on letters, neither of which should happen
    // while a cut-out has focus.
    e.stopPropagation()
    if (arrows[e.key]) {
      e.preventDefault()
      const [dx, dy] = arrows[e.key]
      const next = e.altKey
        ? resizeBox(box, 'se', dx, dy, { square: cutout.locked, aspect })
        : moveBox(box, dx, dy)
      exporter.updateCutout(cutout.id, fromStage(next, layout))
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      exporter.removeCutout(cutout.id)
      frameRef.current?.focus()
    } else if (e.key === 'Escape') {
      exporter.setActiveId(null)
      e.currentTarget.blur()
    }
  }

  const onStage = exporter.cutouts
    .map((c) => ({ cutout: c, box: toStage(c, layout) }))
    .filter((x) => x.box)

  return (
    <div ref={containerRef} data-testid="cutout-stage" style={containerStyle}>
      <p id="cutout-keys-help" style={{ display: 'none' }}>
        {t('pageExport.keysHelp')}
      </p>
      <div
        ref={frameRef}
        tabIndex={-1}
        aria-label={t('pageExport.stageLabel', { pages: layout.pages.join('-') })}
        onPointerDown={startDraw}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        style={{
          position: 'relative',
          width: frameW,
          height: frameH,
          margin: 'auto',
          flexShrink: 0,
          cursor: 'crosshair',
          touchAction: 'none',
          userSelect: 'none',
          outline: 'none',
          boxShadow: '0 4px 20px var(--shadow)',
          borderRadius: 4,
        }}
      >
        {layout.parts.map((part, i) => (
          <img
            key={part.page}
            src={pageUrl(part.page, renderWidth)}
            alt={getAlt ? getAlt(part.page) : ''}
            draggable={false}
            style={{
              position: 'absolute',
              top: 0,
              left: `${(part.offset / layout.width) * 100}%`,
              width: `${(part.width / layout.width) * 100}%`,
              height: '100%',
              display: 'block',
              pointerEvents: 'none',
              borderLeft: i > 0 ? '1px solid var(--shadow)' : 'none',
              boxSizing: 'border-box',
              background: 'var(--on-media)',
            }}
          />
        ))}

        {onStage.map(({ cutout, box }) => {
          const live = drag && drag.id === cutout.id ? drag.box : box
          const shapeName = t(
            `pageExport.tool.${cutout.shape === 'ellipse' ? 'circle' : cutout.locked ? 'square' : 'rect'}`
          )
          return (
            <CutoutBox
              key={cutout.id}
              boxRef={(el) => (boxRefs.current[cutout.id] = el)}
              box={live}
              number={cutout.number}
              shape={cutout.shape}
              locked={cutout.locked}
              active={cutout.id === exporter.activeId}
              label={t('pageExport.boxLabel', { n: cutout.number, shape: shapeName })}
              describedBy="cutout-keys-help"
              onBodyPointerDown={startMove(cutout, box)}
              onHandlePointerDown={startResize(cutout, box)}
              onKeyDown={onBoxKeyDown(cutout, box)}
              onFocus={() => exporter.setActiveId(cutout.id)}
            />
          )
        })}

        {drag?.mode === 'draw' && !isTiny(drag.box) && (
          <span
            style={{
              position: 'absolute',
              left: `${drag.box.x * 100}%`,
              top: `${drag.box.y * 100}%`,
              width: `${drag.box.w * 100}%`,
              height: `${drag.box.h * 100}%`,
              borderRadius: toolSpec.shape === 'ellipse' ? '50%' : 2,
              border: '2px solid var(--gold)',
              background: 'color-mix(in srgb, var(--gold) 16%, transparent)',
              boxShadow: '0 0 0 1px var(--shadow)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {onStage.length === 0 && !drag && (
        <div
          role="note"
          style={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 14px',
            borderRadius: 999,
            fontSize: 12,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            boxShadow: '0 4px 14px var(--shadow)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            maxWidth: 'calc(100% - 32px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {t('pageExport.stageHint')}
        </div>
      )}
    </div>
  )
}
