// Shelf props for component tests, built from plain book lists (issue #221).
//
// SystemCategorySection and BookFolderGroup used to receive their books and
// build the folder tree themselves. They now render a node of the server-built
// shelf tree (shelfTree.js) and read each node's books from the shelf's paged
// lists. These build both from the book lists the tests already describe, as
// the server would answer: groups from the books' paths, and every node's own
// books fully loaded.

import { SORT_FIELDS, buildShelf, nodeKey, shelfComparator } from '../components/system/shelfTree'

function subfolder(book, depth) {
  const parts = (book.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > depth + 2 ? parts.slice(depth + 1, -1).join('/') : ''
}

function dirOf(book) {
  return (book.relative_path || '').replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

/** A paged-lists object (see usePagedLists) holding `lists` fully loaded. */
export function loadedPages(lists) {
  return {
    lists,
    get: (key) =>
      lists[key]
        ? { items: lists[key], total: lists[key].length, hasMore: false, loading: false }
        : undefined,
  }
}

/**
 * `{ shelf, pages }` for `books`: the category roots (shelfTree nodes) and every
 * node's own books, sorted the way the server would send them.
 */
export function shelfFromBooks(books, { depth = 2, sort = 'title', order = 'asc' } = {}) {
  const rows = new Map()
  const lists = {}
  for (const book of books) {
    const category = book.category || 'core'
    const path = subfolder(book, depth)
    const key = `${category}\u0000${dirOf(book)}`
    const row = rows.get(key) || { category, path, dir: dirOf(book), count: 0, first: null }
    row.count += 1
    rows.set(key, row)
    const listKey = nodeKey(category, path)
    lists[listKey] = [...(lists[listKey] || []), book]
  }
  const cmp = shelfComparator(sort, order)
  for (const key of Object.keys(lists)) lists[key].sort(cmp)
  return { shelf: buildShelf([...rows.values()], sort, order), pages: loadedPages(lists) }
}

/**
 * A shelfTree node (plus its loaded books) from an old-style folder-tree node
 * (`{ books, folders: { name -> node } }`), for tests that describe a folder by
 * its contents.
 */
export function shelfNodeFromTree(tree, { category, name, path, sort = 'title', order = 'asc' }) {
  const lists = {}
  const cmp = shelfComparator(sort, order)
  const field = SORT_FIELDS[sort] || 'title'
  const build = (node, nodeName, nodePath) => {
    const books = [...node.books].sort(cmp)
    if (books.length) lists[nodeKey(category, nodePath)] = books
    const folders = Object.fromEntries(
      Object.entries(node.folders).map(([child, sub]) => [
        child,
        build(sub, child, nodePath ? `${nodePath}/${child}` : child),
      ])
    )
    const count = node.books.length + Object.values(folders).reduce((n, f) => n + f.count, 0)
    const dirs = [...new Set(node.books.map(dirOf).filter(Boolean))]
    const first = field === 'title' || !books.length ? null : (books[0][field] ?? null)
    return {
      category,
      name: nodeName,
      path: nodePath,
      direct: node.books.length,
      count,
      dirs,
      first,
      folders,
    }
  }
  return { node: build(tree, name, path), pages: loadedPages(lists) }
}
