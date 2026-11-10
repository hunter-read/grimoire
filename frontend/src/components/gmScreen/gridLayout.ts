/**
 * The GM screen's snap grid, as plain arithmetic the board and its tests share.
 *
 * Twelve columns, rows of a fixed height. A panel stays exactly where it is
 * dropped - the GM pins it there - and anything it lands on is pushed down
 * out of its way, which may push what is below that in turn. Nothing slides up
 * to close a gap, so a board keeps the shape its GM gave it.
 */
export const COLUMNS = 12
export const ROW_HEIGHT = 44
export const GAP = 12
export const MAX_HEIGHT = 40

export interface Cell {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export function overlaps(a: Cell, b: Cell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** A cell held inside the board: on the grid, at least one cell, within the columns. */
export function clampCell(cell: Cell): Cell {
  const w = Math.max(1, Math.min(COLUMNS, Math.round(cell.w)))
  const h = Math.max(1, Math.min(MAX_HEIGHT, Math.round(cell.h)))
  return {
    id: cell.id,
    w,
    h,
    x: Math.max(0, Math.min(COLUMNS - w, Math.round(cell.x))),
    y: Math.max(0, Math.round(cell.y)),
  }
}

/**
 * The layout with one panel at `next`, and everything it now covers pushed
 * down below it.
 */
export function moveCell(layout: Cell[], next: Cell): Cell[] {
  const moved = clampCell(next)
  const cells = layout.map((cell) => (cell.id === moved.id ? moved : { ...cell }))
  // Settled cells are the ones nothing may overlap: the moved panel first,
  // then each panel once it has been pushed clear.
  const settled: Cell[] = [moved]
  const rest = cells.filter((cell) => cell.id !== moved.id).sort((a, b) => a.y - b.y || a.x - b.x)
  for (const cell of rest) {
    let clash = settled.find((other) => overlaps(cell, other))
    while (clash) {
      cell.y = clash.y + clash.h
      clash = settled.find((other) => overlaps(cell, other))
    }
    settled.push(cell)
  }
  return cells
}

/** The cells whose place or size differs between two layouts. */
export function changedCells(before: Cell[], after: Cell[]): Cell[] {
  const was = new Map(before.map((cell) => [cell.id, cell]))
  return after.filter((cell) => {
    const old = was.get(cell.id)
    return !old || old.x !== cell.x || old.y !== cell.y || old.w !== cell.w || old.h !== cell.h
  })
}

/** How far a pointer moved, in whole grid cells, on a board `width` pixels wide. */
export function cellsMoved(dx: number, dy: number, width: number): { dx: number; dy: number } {
  const column = (width - GAP * (COLUMNS - 1)) / COLUMNS
  return {
    dx: Math.round(dx / (column + GAP)) || 0,
    dy: Math.round(dy / (ROW_HEIGHT + GAP)) || 0,
  }
}

/** Reading order - top to bottom, then left to right - for a phone's single column. */
export function readingOrder<T extends Cell>(cells: T[]): T[] {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x)
}

/** How many rows the board needs to show every panel. */
export function boardRows(cells: Cell[]): number {
  return cells.reduce((rows, cell) => Math.max(rows, cell.y + cell.h), 0)
}
