import { describe, it, expect } from 'vitest'
import {
  boardRows,
  cellsMoved,
  changedCells,
  clampCell,
  COLUMNS,
  GAP,
  moveCell,
  overlaps,
  readingOrder,
  ROW_HEIGHT,
  type Cell,
} from './gridLayout'

const cell = (id: string, x: number, y: number, w = 4, h = 2): Cell => ({ id, x, y, w, h })

describe('gridLayout', () => {
  it('tells touching cells from overlapping ones', () => {
    expect(overlaps(cell('a', 0, 0), cell('b', 4, 0))).toBe(false)
    expect(overlaps(cell('a', 0, 0), cell('b', 3, 1))).toBe(true)
    expect(overlaps(cell('a', 0, 0), cell('b', 0, 2))).toBe(false)
  })

  it('keeps a cell on the board', () => {
    expect(clampCell(cell('a', 10, -3, 6, 0))).toEqual(cell('a', 6, 0, 6, 1))
    expect(clampCell(cell('a', 0, 0, 99, 99))).toEqual(cell('a', 0, 0, COLUMNS, 40))
  })

  it('leaves a panel where it is dropped, gaps and all', () => {
    const layout = [cell('a', 0, 0), cell('b', 4, 0)]
    expect(moveCell(layout, cell('a', 8, 6))).toEqual([cell('a', 8, 6), cell('b', 4, 0)])
  })

  it('pushes what a panel lands on down, and what that lands on in turn', () => {
    const layout = [cell('a', 0, 0), cell('b', 0, 2), cell('c', 0, 4), cell('d', 6, 0)]
    const after = moveCell(layout, cell('d', 0, 1))
    const by = Object.fromEntries(after.map((c) => [c.id, c]))
    expect(by.d).toEqual(cell('d', 0, 1))
    expect(by.a.y).toBe(3)
    expect(by.b.y).toBe(5)
    expect(by.c.y).toBe(7)
    for (const one of after)
      for (const other of after) if (one.id !== other.id) expect(overlaps(one, other)).toBe(false)
  })

  it('lists only the cells that changed', () => {
    const before = [cell('a', 0, 0), cell('b', 4, 0)]
    const after = moveCell(before, cell('a', 4, 0))
    expect(changedCells(before, after).map((c) => c.id)).toEqual(['a', 'b'])
    expect(changedCells(before, before)).toEqual([])
  })

  it('turns pointer travel into whole cells', () => {
    const width = 1200
    const column = (width - GAP * (COLUMNS - 1)) / COLUMNS
    expect(cellsMoved(column + GAP, 0, width)).toEqual({ dx: 1, dy: 0 })
    expect(cellsMoved(-(column + GAP) * 2.4, (ROW_HEIGHT + GAP) * 3, width)).toEqual({
      dx: -2,
      dy: 3,
    })
    expect(cellsMoved(5, -5, width)).toEqual({ dx: 0, dy: 0 })
  })

  it('reads a board top to bottom, then left to right', () => {
    const order = readingOrder([cell('c', 0, 4), cell('b', 6, 0), cell('a', 0, 0)])
    expect(order.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(boardRows([cell('a', 0, 0), cell('b', 0, 5, 4, 3)])).toBe(8)
    expect(boardRows([])).toBe(0)
  })
})
