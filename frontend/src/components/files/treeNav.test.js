import { describe, it, expect } from 'vitest'
import {
  indexOfPath,
  nextSelectable,
  parentIndex,
  rightTarget,
  leftTarget,
  rangeBetween,
} from './treeNav'

const dir = (path, depth, isOpen = false) => ({
  entry: { path, name: path.split('/').pop(), is_dir: true },
  depth,
  isOpen,
})
const file = (path, depth) => ({
  entry: { path, name: path.split('/').pop(), is_dir: false },
  depth,
  isOpen: false,
})
const ph = (placeholder, path, depth) => ({ placeholder, path, depth })

// books/
//   core/            (open)
//     phb.pdf
//     dmg.pdf
//   adventures/      (closed)
//   notes.txt
const tree = [
  dir('books/core', 0, true),
  file('books/core/phb.pdf', 1),
  file('books/core/dmg.pdf', 1),
  dir('books/adventures', 0),
  file('books/notes.txt', 0),
]

describe('indexOfPath', () => {
  it('finds a row by its path', () => {
    expect(indexOfPath(tree, 'books/core/dmg.pdf')).toBe(2)
  })

  it('returns -1 for a path that is not on screen', () => {
    expect(indexOfPath(tree, 'books/missing')).toBe(-1)
  })

  it('returns -1 for no path at all, so a null cursor is not a lookup', () => {
    expect(indexOfPath(tree, null)).toBe(-1)
  })
})

describe('nextSelectable', () => {
  it('finds the next row walking forwards', () => {
    expect(nextSelectable(tree, 1, 1)).toBe(1)
    expect(nextSelectable(tree, 2, 1)).toBe(2)
  })

  it('finds the previous row walking backwards', () => {
    expect(nextSelectable(tree, 3, -1)).toBe(3)
  })

  it('skips placeholder rows, which occupy an index but cannot hold a cursor', () => {
    const rows = [
      dir('books/core', 0, true),
      ph('loading', 'books/core', 1),
      file('books/x.pdf', 0),
    ]
    expect(nextSelectable(rows, 1, 1)).toBe(2)
  })

  it('returns -1 rather than wrapping when the walk runs off either end', () => {
    // Wrapping in a tree of thousands of rows loses the user's place entirely.
    expect(nextSelectable(tree, tree.length, 1)).toBe(-1)
    expect(nextSelectable(tree, -1, -1)).toBe(-1)
  })
})

describe('parentIndex', () => {
  it('finds the folder a child sits in', () => {
    expect(parentIndex(tree, 1)).toBe(0)
    expect(parentIndex(tree, 2)).toBe(0)
  })

  it('returns -1 at the top level, where there is nothing to step out to', () => {
    expect(parentIndex(tree, 0)).toBe(-1)
    expect(parentIndex(tree, 4)).toBe(-1)
  })

  it('is not fooled by a truncated placeholder carrying the children depth', () => {
    // `truncated` sits at the end of a folder's children with the children's
    // depth. Comparing depth without checking selectability would mistake it
    // for the parent row.
    const rows = [
      dir('books/core', 0, true),
      file('books/core/phb.pdf', 1),
      ph('truncated', 'books/core', 1),
      file('books/core/dmg.pdf', 1),
    ]
    expect(parentIndex(rows, 3)).toBe(0)
  })

  it('returns -1 for a row that does not exist', () => {
    expect(parentIndex(tree, 99)).toBe(-1)
  })
})

describe('rightTarget', () => {
  it('expands a closed folder', () => {
    expect(rightTarget(tree, 3)).toEqual({ action: 'expand', path: 'books/adventures' })
  })

  it('descends into the first child of an open folder', () => {
    expect(rightTarget(tree, 0)).toEqual({ action: 'move', index: 1 })
  })

  it('does nothing on a file', () => {
    expect(rightTarget(tree, 4)).toBeNull()
  })

  it('stays put on an open but empty folder instead of jumping to its sibling', () => {
    // The only child row is an `empty` placeholder. Skipping to the next
    // selectable row would land on the folder's next *sibling* — an arrow-right
    // that silently jumps past the thing it just opened.
    const rows = [dir('books/empty', 0, true), ph('empty', 'books/empty', 1), dir('books/other', 0)]
    expect(rightTarget(rows, 0)).toBeNull()
  })

  it('stays put on a folder that is still loading', () => {
    const rows = [dir('books/slow', 0, true), ph('loading', 'books/slow', 1), dir('books/other', 0)]
    expect(rightTarget(rows, 0)).toBeNull()
  })

  it('stays put on an open folder that is the last row', () => {
    expect(rightTarget([dir('books/core', 0, true)], 0)).toBeNull()
  })

  it('returns null for a row that does not exist', () => {
    expect(rightTarget(tree, 99)).toBeNull()
  })
})

describe('leftTarget', () => {
  it('collapses an open folder', () => {
    expect(leftTarget(tree, 0)).toEqual({ action: 'collapse', path: 'books/core' })
  })

  it('steps out to the parent from a child row', () => {
    expect(leftTarget(tree, 2)).toEqual({ action: 'move', index: 0 })
  })

  it('steps out to the parent from a closed folder rather than collapsing it again', () => {
    const rows = [dir('books/core', 0, true), dir('books/core/nested', 1)]
    expect(leftTarget(rows, 1)).toEqual({ action: 'move', index: 0 })
  })

  it('does nothing on a top-level file, which has nowhere to step out to', () => {
    expect(leftTarget(tree, 4)).toBeNull()
  })

  it('returns null on a placeholder row', () => {
    expect(leftTarget([ph('loading', 'books/core', 1)], 0)).toBeNull()
  })
})

describe('rangeBetween', () => {
  it('returns every path between two rows, inclusive', () => {
    expect(rangeBetween(tree, 'books/core', 'books/core/dmg.pdf')).toEqual([
      'books/core',
      'books/core/phb.pdf',
      'books/core/dmg.pdf',
    ])
  })

  it('does not care which end is the anchor', () => {
    // The anchor sits below the cursor as often as above it.
    expect(rangeBetween(tree, 'books/core/dmg.pdf', 'books/core')).toEqual([
      'books/core',
      'books/core/phb.pdf',
      'books/core/dmg.pdf',
    ])
  })

  it('covers a single row when both ends are the same', () => {
    expect(rangeBetween(tree, 'books/notes.txt', 'books/notes.txt')).toEqual(['books/notes.txt'])
  })

  it('omits placeholders caught in the middle of the range', () => {
    const rows = [
      dir('books/core', 0, true),
      ph('loading', 'books/core', 1),
      file('books/x.pdf', 0),
    ]
    expect(rangeBetween(rows, 'books/core', 'books/x.pdf')).toEqual(['books/core', 'books/x.pdf'])
  })

  it('returns nothing when either end has left the screen', () => {
    expect(rangeBetween(tree, 'books/core', 'books/gone')).toEqual([])
    expect(rangeBetween(tree, 'books/gone', 'books/core')).toEqual([])
  })
})
