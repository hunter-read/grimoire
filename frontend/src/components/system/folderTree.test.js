import { describe, it, expect } from 'vitest'
import { getBookSubfolderPath, buildFolderTree, countBooks, allBooks } from './folderTree'

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
