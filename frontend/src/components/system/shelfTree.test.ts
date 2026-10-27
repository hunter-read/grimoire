import { describe, it, expect } from 'vitest'
import {
  buildShelf,
  categoryFolderName,
  nodeDirs,
  nodeKey,
  nodeScope,
  orderedNodeEntries,
  shelfComparator,
  splitNodeKey,
  standIn,
} from './shelfTree'

const row = (category, path, count, extra = {}) => ({
  category,
  path,
  dir: `books/Sys/${category}${path ? `/${path}` : ''}`,
  count,
  first: null,
  ...extra,
})

describe('nodeKey', () => {
  it('round-trips a category and path', () => {
    expect(splitNodeKey(nodeKey('core', 'Monsters/Deep'))).toEqual(['core', 'Monsters/Deep'])
    expect(splitNodeKey(nodeKey('core', ''))).toEqual(['core', ''])
  })
})

describe('shelfComparator', () => {
  const sorted = (books, sort, order) =>
    [...books].sort(shelfComparator(sort, order)).map((b) => b.title)

  it('orders titles naturally', () => {
    const books = [{ title: 'Vol 10' }, { title: 'Vol 2' }, { title: 'vol 1' }]
    expect(sorted(books, 'title', 'asc')).toEqual(['vol 1', 'Vol 2', 'Vol 10'])
    expect(sorted(books, 'title', 'desc')).toEqual(['Vol 10', 'Vol 2', 'vol 1'])
  })

  it('puts undated books last whichever way the year sort runs', () => {
    const books = [
      { title: 'A', year: 2000 },
      { title: 'N', year: null },
      { title: 'B', year: 1990 },
    ]
    expect(sorted(books, 'year', 'asc')).toEqual(['B', 'A', 'N'])
    expect(sorted(books, 'year', 'desc')).toEqual(['A', 'B', 'N'])
  })

  it('compares added_at as dates, undated last', () => {
    const books = [
      { title: 'Old', added_at: '2024-01-01T00:00:00Z' },
      { title: 'None', added_at: null },
      { title: 'New', added_at: '2025-06-01T00:00:00Z' },
    ]
    expect(sorted(books, 'added_at', 'desc')).toEqual(['New', 'Old', 'None'])
    expect(sorted(books, 'added_at', 'asc')).toEqual(['Old', 'New', 'None'])
  })

  it('orders product codes naturally with uncoded books last', () => {
    const books = [
      { title: 'Big', product_code: 'PZO10000' },
      { title: 'None', product_code: '' },
      { title: 'Small', product_code: 'PZO9001' },
    ]
    expect(sorted(books, 'product_code', 'asc')).toEqual(['Small', 'Big', 'None'])
    expect(sorted(books, 'product_code', 'desc')).toEqual(['Big', 'Small', 'None'])
  })

  it('treats missing page counts and sizes as zero, then breaks ties by title', () => {
    const books = [{ title: 'B', page_count: 10 }, { title: 'A' }, { title: 'C', page_count: 10 }]
    expect(sorted(books, 'page_count', 'asc')).toEqual(['A', 'B', 'C'])
    expect(sorted([{ title: 'x', file_size: 5 }, { title: 'y' }], 'size', 'desc')).toEqual([
      'x',
      'y',
    ])
  })

  it('falls back to title for an unknown sort', () => {
    expect(sorted([{ title: 'b' }, { title: 'a' }], 'colour', 'asc')).toEqual(['a', 'b'])
  })
})

describe('buildShelf', () => {
  it('nests folders by path segment and totals counts upward', () => {
    const shelf = buildShelf([
      row('core', '', 2),
      row('core', 'Monsters/Deep', 3),
      row('core', 'Monsters', 1),
      row('adventures', 'Strahd', 4),
    ])
    expect(Object.keys(shelf).sort()).toEqual(['adventures', 'core'])
    const core = shelf.core
    expect(core.direct).toBe(2)
    expect(core.count).toBe(6)
    const monsters = core.folders.Monsters
    expect(monsters).toMatchObject({ name: 'Monsters', path: 'Monsters', direct: 1, count: 4 })
    expect(monsters.folders.Deep).toMatchObject({ path: 'Monsters/Deep', direct: 3, count: 3 })
  })

  it('creates intermediate folders that hold no books of their own', () => {
    const shelf = buildShelf([row('core', 'A/B/C', 1)])
    expect(shelf.core.folders.A.direct).toBe(0)
    expect(shelf.core.folders.A.folders.B.folders.C.count).toBe(1)
  })

  it('defaults a missing category to core', () => {
    expect(Object.keys(buildShelf([{ path: '', count: 1 }]))).toEqual(['core'])
  })

  it('keeps the best first value when two directories map to one node', () => {
    const shelf = buildShelf(
      [
        row('core', 'F', 1, { dir: 'books/Sys/Core/F', first: 2005 }),
        row('core', 'F', 1, { dir: 'books/Sys/Core2/F', first: 1999 }),
      ],
      'year',
      'asc'
    )
    expect(shelf.core.folders.F.first).toBe(1999)
    expect(shelf.core.folders.F.dirs).toEqual(['books/Sys/Core/F', 'books/Sys/Core2/F'])
  })
})

describe('standIn', () => {
  const shelf = buildShelf(
    [row('core', 'A', 1, { first: 2010 }), row('core', 'A/Deep', 1, { first: 1980 })],
    'year',
    'asc'
  )

  it('is the folder name for the title sort', () => {
    expect(standIn(shelf.core.folders.A, 'title', 'asc')).toEqual({ title: 'A' })
  })

  it('is the first value anywhere beneath the folder for other sorts', () => {
    expect(standIn(shelf.core.folders.A, 'year', 'asc').year).toBe(1980)
  })

  it('carries no value for a folder whose books have none', () => {
    const bare = buildShelf([row('core', 'X', 1)], 'year', 'asc')
    expect(standIn(bare.core.folders.X, 'year', 'asc').year).toBeNull()
  })
})

describe('orderedNodeEntries', () => {
  const shelf = buildShelf([row('core', '', 2), row('core', 'Bravo', 1), row('core', 'Delta', 1)])
  const books = [
    { id: '1', title: 'Alpha' },
    { id: '2', title: 'Charlie' },
  ]
  const kinds = (entries) =>
    entries.map((e) => (e.type === 'folder' ? `F:${e.name}` : e.book.title))

  it('puts folders first by default', () => {
    expect(kinds(orderedNodeEntries(shelf.core, books))).toEqual([
      'F:Bravo',
      'F:Delta',
      'Alpha',
      'Charlie',
    ])
  })

  it('sorts folders in among the books when mixed', () => {
    const entries = orderedNodeEntries(shelf.core, books, { placement: 'mixed' })
    expect(kinds(entries)).toEqual(['Alpha', 'F:Bravo', 'Charlie', 'F:Delta'])
  })

  it('holds back folders past the last loaded book while more books are coming', () => {
    const entries = orderedNodeEntries(shelf.core, books, { placement: 'mixed', hasMore: true })
    expect(kinds(entries)).toEqual(['Alpha', 'F:Bravo', 'Charlie'])
  })
})

describe('scopes and labels', () => {
  const shelf = buildShelf([
    row('core', 'Monsters', 1, { dir: 'books/Sys/Core Rulebooks/Monsters' }),
    row('core', 'Spells', 1, { dir: 'books/Sys/Core Rulebooks/Spells' }),
  ])

  it('collects every directory at or below a node', () => {
    expect(nodeDirs(shelf.core).sort()).toEqual([
      'books/Sys/Core Rulebooks/Monsters',
      'books/Sys/Core Rulebooks/Spells',
    ])
  })

  it('scopes a rescan to the deepest shared directory', () => {
    expect(nodeScope(shelf.core, 2, 'books/Sys')).toBe('books/Sys/Core Rulebooks')
    expect(nodeScope(shelf.core.folders.Monsters, 2)).toBe('books/Sys/Core Rulebooks/Monsters')
  })

  it('falls back when the directories diverge above the system, or there are none', () => {
    const split = buildShelf([
      row('core', '', 1, { dir: 'books/A/core' }),
      row('core', 'x', 1, { dir: 'books/B/core/x' }),
    ])
    expect(nodeScope(split.core, 2, 'fallback')).toBe('fallback')
    expect(nodeScope({ dirs: [], folders: {} }, 2, 'fallback')).toBe('fallback')
  })

  it("reads the category folder's own name from a directory", () => {
    expect(categoryFolderName(shelf.core, 2)).toBe('Core Rulebooks')
    expect(categoryFolderName({ dirs: ['books/Sys'], folders: {} }, 2)).toBeNull()
  })
})
