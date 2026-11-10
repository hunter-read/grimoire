import { useMemo, useRef } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import useIsMobile from '../../hooks/useIsMobile'
import { boardRows, GAP, readingOrder, ROW_HEIGHT, type Cell } from './gridLayout'
import type { Panel } from './types'
import useBoardDrag from './useBoardDrag'

/** What a panel's frame needs to be dragged and resized. */
export interface PanelHandles {
  onMovePointerDown: (event: PointerEvent<HTMLElement>) => void
  onResizePointerDown: (event: PointerEvent<HTMLElement>) => void
  onHandleKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  /** False on a phone, where panels stack and do not move. */
  movable: boolean
}

interface GmBoardProps {
  panels: Panel[]
  onMove: (cells: Cell[]) => void
  renderPanel: (panel: Panel, handles: PanelHandles) => ReactNode
}

/**
 * The GM screen's snap grid. Each panel sits on its own cells; dragging one
 * shows where it would land, neighbours pushed aside, before it is let go.
 *
 * A phone has no room for a twelve-column board, so there the panels stack in
 * reading order at full width, and moving them waits for a bigger screen.
 */
export default function GmBoard({ panels, onMove, renderPanel }: GmBoardProps) {
  const mobile = useIsMobile()
  const boardRef = useRef<HTMLDivElement>(null)
  const cells = useMemo<Cell[]>(
    () => panels.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
    [panels]
  )
  const drag = useBoardDrag(cells, boardRef, onMove)
  const shown = new Map((drag.preview ?? cells).map((cell) => [cell.id, cell]))

  const handles = (id: string): PanelHandles => ({
    onMovePointerDown: (event) => drag.startMove(event, id),
    onResizePointerDown: (event) => drag.startResize(event, id),
    onHandleKeyDown: (event) => drag.onKeyDown(event, id),
    movable: !mobile,
  })

  if (mobile) {
    return (
      <div className="gm-board gm-board-stacked" style={{ display: 'grid', gap: GAP }}>
        {readingOrder(panels).map((panel) => (
          <div key={panel.id} style={{ minHeight: panel.h * ROW_HEIGHT }}>
            {renderPanel(panel, handles(panel.id))}
          </div>
        ))}
      </div>
    )
  }

  const rows = boardRows([...shown.values()])
  return (
    <div
      ref={boardRef}
      className="gm-board"
      data-dragging={drag.dragging || undefined}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerUp}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
        gridAutoRows: ROW_HEIGHT,
        gap: GAP,
        // Room below the last panel to drag one into.
        minHeight: (rows + 2) * (ROW_HEIGHT + GAP),
        userSelect: drag.dragging ? 'none' : undefined,
      }}
    >
      {panels.map((panel) => {
        const cell = shown.get(panel.id) ?? panel
        return (
          <div
            key={panel.id}
            data-panel-id={panel.id}
            style={{
              gridColumn: `${cell.x + 1} / span ${cell.w}`,
              gridRow: `${cell.y + 1} / span ${cell.h}`,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {renderPanel(panel, handles(panel.id))}
          </div>
        )
      })}
    </div>
  )
}
