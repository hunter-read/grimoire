import { describe, it, expect } from 'vitest'
import {
  getBookSubfolderPath,
  buildFolderTree,
  countBooks,
  allBooks,
  categoryDepth,
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
