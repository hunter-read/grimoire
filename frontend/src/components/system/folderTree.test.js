import { describe, it, expect } from 'vitest'
import {
  getBookSubfolderPath,
  buildFolderTree,
  countBooks,
  allBooks,
  categoryDepth,
  orderedEntries,
  orderedBooks,
  entryRuns,
} from './folderTree'

function book(id, relative_path) {
  return { id, relative_path }
}

describe('getBookSubfolderPath', () => {
  it('returns [] for a book directly in the category dir', () => {
    // books/{System}/{category}/book.pdf → 4 segments, no subfolder
    expect(getBookSubfolderPath(book('b', 'books/D&D 5e/core/book.pdf'))).toEqual([])
  })

  it('returns a single segment for one level of nesting', () => {
    expect(getBookSubfolderPath(book('b', 'books/D&D 5e/core/monsters/book.pdf'))).toEqual([
      'monsters',
    ])
  })

  it('returns all segments for deep nesting', () => {
    expect(
      getBookSubfolderPath(book('b', 'books/D&D 5e/core/monsters/spelljammer/book.pdf'))
    ).toEqual(['monsters', 'spelljammer'])
  })

  it('normalizes backslash separators', () => {
    expect(getBookSubfolderPath(book('b', 'books\\D&D 5e\\core\\monsters\\book.pdf'))).toEqual([
      'monsters',
    ])
  })

  it('returns [] when relative_path is missing', () => {
    expect(getBookSubfolderPath({})).toEqual([])
  })
})

describe('categoryDepth', () => {
  it('is 2 for an ordinary system', () => {
    expect(categoryDepth({ id: 's1' })).toBe(2)
    expect(categoryDepth(null)).toBe(2)
  })

  it('is 3 for a system nested in a container', () => {
    expect(categoryDepth({ id: 's1', parent_id: 'container' })).toBe(3)
  })

  // Containers nest (issue #301) and the payload carries only the immediate
  // parent, so the server sends the resolved depth (issue #357).
  it('prefers the server-sent category_depth', () => {
    expect(categoryDepth({ id: 's1', parent_id: 'inner', category_depth: 4 })).toBe(4)
  })

  it('uses category_depth even when there is no parent_id', () => {
    expect(categoryDepth({ id: 's1', category_depth: 2 })).toBe(2)
  })

  it('falls back to parent_id when category_depth is absent', () => {
    expect(categoryDepth({ id: 's1', parent_id: 'c' })).toBe(3)
    expect(categoryDepth({ id: 's1', category_depth: undefined })).toBe(2)
  })
})

describe('getBookSubfolderPath for container children', () => {
  // books/{Container}/{System}/{category}/… — one level deeper than usual, so
  // the category folder must not be mistaken for a subfolder.
  const mm = book('mm', 'books/Dungeons & Dragons/5e/Monster Manuals/mm.pdf')

  it('treats a custom category folder as the category, not a subfolder', () => {
    expect(getBookSubfolderPath(mm, 3)).toEqual([])
  })

  it('regresses the reported bug when the flat depth is assumed', () => {
    // At depth 2 the system folder ("5e") reads as the category and the real
    // category nests under it — which is what surfaced one "5e" heading per
    // custom category slug.
    expect(getBookSubfolderPath(mm, 2)).toEqual(['Monster Manuals'])
  })

  it('still reports genuine subfolders below the category', () => {
    expect(
      getBookSubfolderPath(book('d', 'books/D&D/5e/Monster Manuals/spelljammer/d.pdf'), 3)
    ).toEqual(['spelljammer'])
  })

  it('returns [] for a book directly in the container child category dir', () => {
    expect(getBookSubfolderPath(book('c', 'books/D&D/5e/core/phb.pdf'), 3)).toEqual([])
  })
})

describe('buildFolderTree for container children', () => {
  it('does not create a folder level for the system dir', () => {
    // Three custom categories previously rendered three separate "5e" headings,
    // one per category section, each wrapping its real category as a subfolder.
    const books = [
      book('a', 'books/D&D/5e/Monster Manuals/a.pdf'),
      book('b', 'books/D&D/5e/Monster Manuals/b.pdf'),
    ]
    const tree = buildFolderTree(books, 3)
    expect(Object.keys(tree.folders)).toEqual([])
    expect(tree.books.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('buildFolderTree', () => {
  it('collects ungrouped books at the root', () => {
    const tree = buildFolderTree([book('a', 'books/S/core/a.pdf'), book('b', 'books/S/core/b.pdf')])
    expect(tree.books.map((x) => x.id)).toEqual(['a', 'b'])
    expect(Object.keys(tree.folders)).toEqual([])
  })

  it('nests books under their subfolder path', () => {
    const tree = buildFolderTree([
      book('root', 'books/S/core/root.pdf'),
      book('m', 'books/S/core/monsters/m.pdf'),
      book('deep', 'books/S/core/monsters/spelljammer/deep.pdf'),
    ])
    expect(tree.books.map((x) => x.id)).toEqual(['root'])
    expect(tree.folders.monsters.books.map((x) => x.id)).toEqual(['m'])
    expect(tree.folders.monsters.folders.spelljammer.books.map((x) => x.id)).toEqual(['deep'])
  })
})

describe('countBooks', () => {
  it('counts books at and below a node', () => {
    const tree = buildFolderTree([
      book('root', 'books/S/core/root.pdf'),
      book('m', 'books/S/core/monsters/m.pdf'),
      book('deep', 'books/S/core/monsters/spelljammer/deep.pdf'),
    ])
    expect(countBooks(tree)).toBe(3)
    expect(countBooks(tree.folders.monsters)).toBe(2)
    expect(countBooks(tree.folders.monsters.folders.spelljammer)).toBe(1)
  })
})

describe('allBooks', () => {
  it('flattens a node in tree order, own books before nested (folders alphabetical)', () => {
    const tree = buildFolderTree([
      book('root', 'books/S/core/root.pdf'),
      book('z', 'books/S/core/zeta/z.pdf'),
      book('a', 'books/S/core/alpha/a.pdf'),
    ])
    expect(allBooks(tree).map((x) => x.id)).toEqual(['root', 'a', 'z'])
  })
})

// Issue #448: where folders sit among the books beside them.
describe('orderedEntries', () => {
  // The reporter's shelf: 1036 shipped with companion sheets, so it is a folder.
  const shelf = () =>
    buildFolderTree([
      {
        id: '1035',
        title: 'Aventurisches Jahrbuch 1035 BF',
        relative_path: 'books/S/core/j1035.pdf',
      },
      {
        id: '1037',
        title: 'Aventurisches Jahrbuch 1037 BF',
        relative_path: 'books/S/core/j1037.pdf',
      },
      {
        id: '1036',
        title: 'Aventurisches Jahrbuch 1036 BF',
        relative_path: 'books/S/core/AVENTURISCHES JAHRBUCH 1036 BF/j1036.pdf',
      },
    ])
  const labels = (entries) => entries.map((e) => (e.type === 'folder' ? `[${e.name}]` : e.book.id))

  it('puts folders ahead of loose books by default', () => {
    expect(labels(orderedEntries(shelf()))).toEqual([
      '[AVENTURISCHES JAHRBUCH 1036 BF]',
      '1035',
      '1037',
    ])
  })

  it('sorts a folder in among the books by its name when mixed', () => {
    expect(labels(orderedEntries(shelf(), { placement: 'mixed' }))).toEqual([
      '1035',
      '[AVENTURISCHES JAHRBUCH 1036 BF]',
      '1037',
    ])
  })

  it('reverses folders and books together for a descending title sort', () => {
    expect(labels(orderedEntries(shelf(), { order: 'desc', placement: 'mixed' }))).toEqual([
      '1037',
      '[AVENTURISCHES JAHRBUCH 1036 BF]',
      '1035',
    ])
    expect(labels(orderedEntries(shelf(), { order: 'desc' }))).toEqual([
      '[AVENTURISCHES JAHRBUCH 1036 BF]',
      '1037',
      '1035',
    ])
  })

  it('orders folders by their name even in folders-first placement', () => {
    const tree = buildFolderTree([
      book('z', 'books/S/core/Zeta/z.pdf'),
      book('a', 'books/S/core/Alpha/a.pdf'),
    ])
    expect(labels(orderedEntries(tree))).toEqual(['[Alpha]', '[Zeta]'])
    expect(labels(orderedEntries(tree, { order: 'desc' }))).toEqual(['[Zeta]', '[Alpha]'])
  })

  it('places a folder by its first book for a non-title sort', () => {
    const tree = buildFolderTree([
      { id: 'y1990', title: 'A', year: 1990, relative_path: 'books/S/core/a.pdf' },
      { id: 'y2010', title: 'B', year: 2010, relative_path: 'books/S/core/b.pdf' },
      { id: 'f2020', title: 'C', year: 2020, relative_path: 'books/S/core/Extras/c.pdf' },
      { id: 'f2000', title: 'D', year: 2000, relative_path: 'books/S/core/Extras/d.pdf' },
    ])
    // Ascending by year the folder's earliest book is 2000, so it lands between 1990 and 2010.
    expect(labels(orderedEntries(tree, { sort: 'year', placement: 'mixed' }))).toEqual([
      'y1990',
      '[Extras]',
      'y2010',
    ])
    // Descending, its first book is 2020, so it leads.
    expect(
      labels(orderedEntries(tree, { sort: 'year', order: 'desc', placement: 'mixed' }))
    ).toEqual(['[Extras]', 'y2010', 'y1990'])
  })

  it('puts a folder ahead of a book it ties with', () => {
    const tree = buildFolderTree([
      { id: 'b', title: 'Same', relative_path: 'books/S/core/same.pdf' },
      { id: 'f', title: 'x', relative_path: 'books/S/core/Same/x.pdf' },
    ])
    expect(labels(orderedEntries(tree, { placement: 'mixed' }))).toEqual(['[Same]', 'b'])
  })

  it('applies the same rule inside a folder as at the category level', () => {
    const tree = buildFolderTree([
      { id: 'r1', title: '1. First', relative_path: 'books/S/core/Regional/r1.pdf' },
      { id: 'r2', title: '2. Second', relative_path: 'books/S/core/Regional/r2.pdf' },
      { id: 'r3', title: '3. Third', relative_path: 'books/S/core/Regional/3. Third/r3.pdf' },
    ])
    const regional = tree.folders.Regional
    expect(labels(orderedEntries(regional))).toEqual(['[3. Third]', 'r1', 'r2'])
    expect(labels(orderedEntries(regional, { placement: 'mixed' }))).toEqual([
      'r1',
      'r2',
      '[3. Third]',
    ])
  })
})

describe('orderedBooks', () => {
  it('flattens the tree in the order it renders', () => {
    const tree = buildFolderTree([
      { id: 'a', title: 'A', relative_path: 'books/S/core/a.pdf' },
      { id: 'c', title: 'C', relative_path: 'books/S/core/c.pdf' },
      { id: 'b1', title: 'B1', relative_path: 'books/S/core/B/b1.pdf' },
      { id: 'b0', title: 'B0', relative_path: 'books/S/core/B/Inner/b0.pdf' },
    ])
    expect(orderedBooks(tree).map((b) => b.id)).toEqual(['b0', 'b1', 'a', 'c'])
    expect(orderedBooks(tree, { placement: 'mixed' }).map((b) => b.id)).toEqual([
      'a',
      'b1',
      'b0',
      'c',
    ])
  })
})

describe('entryRuns', () => {
  it('gathers consecutive books into runs between folders', () => {
    const node = { books: [], folders: {} }
    const runs = entryRuns([
      { type: 'book', book: { id: 1 } },
      { type: 'book', book: { id: 2 } },
      { type: 'folder', name: 'F', node },
      { type: 'book', book: { id: 3 } },
    ])
    expect(runs).toEqual([
      { type: 'books', books: [{ id: 1 }, { id: 2 }] },
      { type: 'folder', name: 'F', node },
      { type: 'books', books: [{ id: 3 }] },
    ])
  })

  it('returns no runs for no entries', () => {
    expect(entryRuns([])).toEqual([])
  })
})
