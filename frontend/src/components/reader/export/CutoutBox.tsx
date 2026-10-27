import type { FocusEvent, KeyboardEvent, PointerEvent, Ref } from 'react'
import type { Box, Handle } from './cutoutGeometry'
import { numberStyle } from './exportStyles'
import type { CutoutShape } from './usePageExport'

export interface CutoutBoxProps {
  box: Box
  number: number
  shape: CutoutShape
  locked?: boolean
  active: boolean
  label: string
  describedBy?: string
  onBodyPointerDown: (e: PointerEvent<HTMLDivElement>) => void
  onHandlePointerDown: (e: PointerEvent<HTMLSpanElement>, handle: Handle) => void
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
  onFocus: (e: FocusEvent<HTMLDivElement>) => void
  boxRef?: Ref<HTMLDivElement>
}

const CORNERS = ['nw', 'ne', 'sw', 'se']
const EDGES = ['n', 's', 'e', 'w']

const CURSORS: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
}

/** Where a handle sits on the box, as percentages. */
function handlePosition(h: Handle) {
  return {
    left: h.includes('w') ? '0%' : h.includes('e') ? '100%' : '50%',
    top: h.includes('n') ? '0%' : h.includes('s') ? '100%' : '50%',
  }
}

/**
 * One cut-out drawn over the page.
 *
 * The outline is dashed until selected, then solid with handles: corners only
 * for a square or circle (which stay square on the page), corners and edges for
 * a free rectangle. Handles have a larger invisible hit area than their drawn
 * size, so they can be caught with a finger as well as a mouse.
 *
 * A box is focusable. With it focused, the arrow keys move it, Alt+arrows
 * resize it and Delete removes it - the stage owns those keys while drawing.
 */
export default function CutoutBox({
  box,
  number,
  shape,
  locked,
  active,
  label,
  describedBy,
  onBodyPointerDown,
  onHandlePointerDown,
  onKeyDown,
  onFocus,
  boxRef,
}: CutoutBoxProps) {
  const round = shape === 'ellipse'
  const handles = active ? (locked ? CORNERS : [...CORNERS, ...EDGES]) : []

  return (
    <div
      ref={boxRef}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={active}
      aria-describedby={describedBy}
      data-cutout-box=""
      onPointerDown={onBodyPointerDown}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      style={{
        position: 'absolute',
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        cursor: 'move',
        touchAction: 'none',
        outline: 'none',
        zIndex: active ? 2 : 1,
      }}
    >
      {/* The bounding box, faint, while a circle is selected - it is what the
          corner handles are dragging. */}
      {round && active && (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            border: '1px dashed var(--gold)',
            opacity: 0.45,
            pointerEvents: 'none',
          }}
        />
      )}
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: round ? '50%' : 2,
          border: active ? '2px solid var(--gold)' : '1.5px dashed var(--gold)',
          background: active
            ? 'color-mix(in srgb, var(--gold) 16%, transparent)'
            : 'color-mix(in srgb, var(--gold) 8%, transparent)',
          // A dark hairline outside the gold keeps the outline readable on a
          // parchment-coloured page as well as a dark one.
          boxShadow: '0 0 0 1px var(--shadow), 0 1px 4px var(--shadow)',
          pointerEvents: 'none',
          transition: 'background 150ms ease-out',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          ...numberStyle(active),
          position: 'absolute',
          // On a circle the badge rides the outline at 45 degrees; on a
          // rectangle it tucks just inside the corner, clear of the resize
          // handle that sits on the corner itself.
          left: round ? '14.6%' : 4,
          top: round ? '14.6%' : 4,
          transform: round ? 'translate(-50%, -50%)' : 'none',
          pointerEvents: 'none',
          boxShadow: '0 1px 3px var(--shadow)',
        }}
      >
        {number}
      </span>
      {handles.map((h) => (
        <span
          key={h}
          data-handle={h}
          onPointerDown={(e) => onHandlePointerDown(e, h)}
          style={{
            position: 'absolute',
            ...handlePosition(h),
            width: 22,
            height: 22,
            transform: 'translate(-50%, -50%)',
            cursor: CURSORS[h],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            touchAction: 'none',
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              background: 'var(--bg-panel)',
              border: '1.5px solid var(--gold)',
              boxShadow: '0 1px 3px var(--shadow)',
            }}
          />
        </span>
      ))}
    </div>
  )
}
