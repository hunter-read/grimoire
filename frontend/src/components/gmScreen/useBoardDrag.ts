import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { cellsMoved, moveCell, type Cell } from './gridLayout'

type Mode = 'move' | 'resize'

interface Drag {
  mode: Mode
  id: string
  pointerX: number
  pointerY: number
  origin: Cell
  // The board as it was when the drag began. Each move is worked out from
  // it, so dragging past a panel and back puts that panel back too.
  base: Cell[]
  width: number
}

const STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** Where a panel moving (or growing) by `dx`, `dy` cells would be. */
const target = (mode: Mode, origin: Cell, dx: number, dy: number): Cell =>
  mode === 'move'
    ? { ...origin, x: origin.x + dx, y: origin.y + dy }
    : { ...origin, w: origin.w + dx, h: origin.h + dy }

/**
 * Dragging panels around the snap grid, by pointer or by keyboard.
 *
 * While a pointer drags, `preview` is the layout as it would be if dropped
 * here - neighbours already pushed aside - so the board shows the drop before
 * it happens. Letting go commits it. The keyboard does the same a cell at a
 * time: arrows move a panel from its handle, Shift+arrows resize it.
 */
export default function useBoardDrag(
  cells: Cell[],
  boardRef: RefObject<HTMLElement | null>,
  onCommit: (next: Cell[]) => void
) {
  const [preview, setPreview] = useState<Cell[] | null>(null)
  const drag = useRef<Drag | null>(null)
  const latest = useRef<Cell[] | null>(null)

  const start = useCallback(
    (mode: Mode) => (event: PointerEvent<HTMLElement>, id: string) => {
      if (event.button !== 0) return
      const origin = cells.find((cell) => cell.id === id)
      if (!origin) return
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      drag.current = {
        mode,
        id,
        pointerX: event.clientX,
        pointerY: event.clientY,
        origin,
        base: cells,
        width: boardRef.current?.clientWidth || 1200,
      }
      latest.current = cells
      setPreview(cells)
    },
    [cells, boardRef]
  )

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current || !latest.current) return
    const { dx, dy } = cellsMoved(
      event.clientX - current.pointerX,
      event.clientY - current.pointerY,
      current.width
    )
    const next = moveCell(current.base, target(current.mode, current.origin, dx, dy))
    setPreview(next)
    latest.current = next
  }, [])

  const onPointerUp = useCallback(() => {
    if (!drag.current) return
    drag.current = null
    const next = latest.current
    latest.current = null
    setPreview(null)
    if (next) onCommit(next)
  }, [onCommit])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, id: string) => {
      const step = STEPS[event.key]
      const origin = cells.find((cell) => cell.id === id)
      if (!step || !origin) return
      event.preventDefault()
      onCommit(moveCell(cells, target(event.shiftKey ? 'resize' : 'move', origin, ...step)))
    },
    [cells, onCommit]
  )

  return {
    preview,
    dragging: preview !== null,
    startMove: start('move'),
    startResize: start('resize'),
    onPointerMove,
    onPointerUp,
    onKeyDown,
  }
}
