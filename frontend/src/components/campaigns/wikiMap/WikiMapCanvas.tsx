import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { LuMinus, LuPlus, LuScan } from 'react-icons/lu'
import Spinner from '../../Spinner'
import MapPinMarker from './MapPinMarker'
import {
  IDENTITY,
  movedPastThreshold,
  nudge,
  toFraction,
  zoomAt,
  type MapView,
} from './mapGeometry'
import type { WikiPin } from './mapPages'

// How tall the canvas is: room to read a region map without pushing the
// page's own text out of reach.
const CANVAS_HEIGHT = 'clamp(320px, 62vh, 760px)'
const ZOOM_STEP = 1.4

interface WikiMapCanvasProps {
  src: string
  alt: string
  pins: WikiPin[]
  editing: boolean
  selectedPinId: string | null
  hrefFor: (pin: WikiPin) => string | null
  onSelectPin: (id: string) => void
  /** Editing: a click on the map itself, at fractions of it. */
  onAddPin: (x: number, y: number) => void
  onMovePin: (id: string, x: number, y: number) => void
}

interface Drag {
  kind: 'pan' | 'pin'
  pinId?: string
  startX: number
  startY: number
  origin: MapView
  moved: boolean
}

/**
 * A map page's picture, which pans and zooms, with its pins on top (issue #578).
 *
 * Drag to pan; zoom with the wheel, a pinch of the trackpad, or the buttons in
 * the corner. While editing, a click on the map adds a pin there, and a pin can
 * be dragged to a new spot - or, from the keyboard, focused and moved with the
 * arrow keys (Shift for bigger steps). The pin list under the map is the other
 * way to reach every pin without a pointer.
 */
export default function WikiMapCanvas({
  src,
  alt,
  pins,
  editing,
  selectedPinId,
  hrefFor,
  onSelectPin,
  onAddPin,
  onMovePin,
}: WikiMapCanvasProps) {
  const { t } = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<MapView>(IDENTITY)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  // Where a pin being dragged (or nudged) is right now, before it is saved.
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null)
  const drag = useRef<Drag | null>(null)
  // Set as a drag ends: the click a browser sends after it belongs to the drag,
  // not to the pin it started on, so it must neither open that pin's editor
  // nor follow its link.
  const justDragged = useRef(false)
  // Read from the wheel listener, which is attached once.
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
    setView(IDENTITY)
  }, [src])

  // The point under the pointer, measured from the wrapper's untransformed
  // top-left - the frame zoomAt works in.
  const localPoint = (clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    const wrapper = wrapperRef.current
    if (!viewport || !wrapper) return { x: 0, y: 0 }
    const rect = viewport.getBoundingClientRect()
    return {
      x: clientX - rect.left - viewport.clientLeft - wrapper.offsetLeft,
      y: clientY - rect.top - viewport.clientTop - wrapper.offsetTop,
    }
  }

  // Wheel zoom needs a non-passive listener to keep the page from scrolling,
  // which React's onWheel can't give.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = localPoint(e.clientX, e.clientY)
      setView(zoomAt(viewRef.current, Math.exp(-e.deltaY / 300), p.x, p.y))
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  const zoomCentre = (factor: number) => {
    const wrapper = wrapperRef.current
    const cx = wrapper ? wrapper.offsetWidth / 2 : 0
    const cy = wrapper ? wrapper.offsetHeight / 2 : 0
    setView((v) => zoomAt(v, factor, cx, cy))
  }

  const fraction = (clientX: number, clientY: number) =>
    toFraction(clientX, clientY, wrapperRef.current!.getBoundingClientRect())

  const startPan = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    drag.current = {
      kind: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      origin: view,
      moved: false,
    }
  }

  const startPinDrag = (pin: WikiPin) => (e: PointerEvent<HTMLElement>) => {
    if (!editing || e.button !== 0) return
    e.stopPropagation()
    drag.current = {
      kind: 'pin',
      pinId: pin.id,
      startX: e.clientX,
      startY: e.clientY,
      origin: view,
      moved: false,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && !movedPastThreshold(dx, dy)) return
    if (!d.moved) {
      // Captured only once it is a drag: capturing on press would take the
      // click away from a pin's link.
      viewportRef.current?.setPointerCapture?.(e.pointerId)
      d.moved = true
    }
    if (d.kind === 'pan') {
      // At scale 1 the whole map is already in view; there is nowhere to go.
      if (d.origin.scale > 1) setView({ ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy })
    } else if (d.pinId) {
      setLive({ id: d.pinId, ...fraction(e.clientX, e.clientY) })
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      justDragged.current = true
      setTimeout(() => {
        justDragged.current = false
      }, 0)
    }
    if (d.kind === 'pin' && d.pinId) {
      // Not moved, it is a click, which the pin's own onClick handles.
      if (d.moved) {
        const at = fraction(e.clientX, e.clientY)
        setLive(null)
        onMovePin(d.pinId, at.x, at.y)
      }
      return
    }
    // A click on the map, not a pan: while editing, that places a pin. A click
    // that landed on a pin or a control was theirs.
    const onControl = (e.target as Element).closest?.('[data-pin-id], button, a')
    if (!d.moved && editing && loaded && !onControl) {
      const at = fraction(e.clientX, e.clientY)
      onAddPin(at.x, at.y)
    }
  }

  const onPinKeyDown = (pin: WikiPin) => (e: KeyboardEvent<HTMLElement>) => {
    if (!editing) return
    const current = live?.id === pin.id ? live : pin
    const next = nudge(e.key, e.shiftKey, current)
    if (!next) return
    e.preventDefault()
    setLive({ id: pin.id, ...next })
  }

  // A nudged pin is saved once focus leaves it, not on every arrow press.
  const onPinBlur = () => {
    if (live && !drag.current) {
      onMovePin(live.id, live.x, live.y)
      setLive(null)
    }
  }

  return (
    <div
      ref={viewportRef}
      data-testid="wiki-map-canvas"
      onPointerDown={startPan}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
        setLive(null)
      }}
      onBlur={onPinBlur}
      style={{
        position: 'relative',
        height: CANVAS_HEIGHT,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        cursor: editing ? 'crosshair' : view.scale > 1 ? 'grab' : 'default',
        // A finger on an unzoomed map scrolls the page, as it would anywhere
        // else; once there is a map to pan, or pins to place, it is the map's.
        touchAction: editing || view.scale > 1 ? 'none' : 'pan-y',
        userSelect: 'none',
      }}
    >
      {!loaded && !failed && (
        <div style={{ position: 'absolute' }} aria-live="polite">
          <Spinner size={28} />
        </div>
      )}
      {failed ? (
        <p role="alert" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {t('wikiMap.loadFailed')}
        </p>
      ) : (
        <div
          ref={wrapperRef}
          style={{
            position: 'relative',
            display: 'inline-block',
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
            lineHeight: 0,
          }}
        >
          <img
            key={src}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: CANVAS_HEIGHT,
              opacity: loaded ? 1 : 0,
              transition: 'opacity 0.15s ease-in',
            }}
          />
          {loaded &&
            pins.map((pin) => {
              const at = live?.id === pin.id ? live : pin
              return (
                <MapPinMarker
                  key={pin.id}
                  pin={pin}
                  x={at.x}
                  y={at.y}
                  scale={view.scale}
                  editing={editing}
                  selected={pin.id === selectedPinId}
                  href={hrefFor(pin)}
                  onSelect={(e) => {
                    if (justDragged.current) {
                      e.preventDefault()
                      return
                    }
                    onSelectPin(pin.id)
                  }}
                  onPointerDown={startPinDrag(pin)}
                  onKeyDown={onPinKeyDown(pin)}
                />
              )
            })}
        </div>
      )}

      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}
      >
        <button
          type="button"
          onClick={() => zoomCentre(ZOOM_STEP)}
          aria-label={t('wikiMap.zoomIn')}
          title={t('wikiMap.zoomIn')}
          style={zoomBtn}
        >
          <LuPlus size={14} />
        </button>
        <button
          type="button"
          onClick={() => zoomCentre(1 / ZOOM_STEP)}
          aria-label={t('wikiMap.zoomOut')}
          title={t('wikiMap.zoomOut')}
          style={zoomBtn}
        >
          <LuMinus size={14} />
        </button>
        <button
          type="button"
          onClick={() => setView(IDENTITY)}
          aria-label={t('wikiMap.zoomReset')}
          title={t('wikiMap.zoomReset')}
          style={zoomBtn}
        >
          <LuScan size={14} />
        </button>
      </div>
    </div>
  )
}

const zoomBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  padding: 0,
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
}
