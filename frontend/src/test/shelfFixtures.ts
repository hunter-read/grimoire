// Shelf props for component tests, built from plain book lists (issue #221).
//
// SystemCategorySection and BookFolderGroup used to receive their books and
// build the folder tree themselves. They now render a node of the server-built
// shelf tree (shelfTree.ts) and read each node's books from the shelf's paged
// lists. These build both from the book lists the tests already describe, as
// the server would answer: groups from the books' paths, and every node's own
// books fully loaded.

import type { Schema } from '../api'
import type { PagedLists } from '../hooks/usePagedLists'
import type { ShelfPages } from '../components/system/ShelfNodeBody'
import {
  SORT_FIELDS,
  buildShelf,
  nodeKey,
  shelfComparator,
  type ShelfNode,
} from '../components/system/shelfTree'

/** The book fields the fixtures read; tests pass whatever else they need. */
export interface FixtureBook {
  title?: string | null
  product_code?: string | null
  relative_path?: string | null
  category?: string | null
  [field: string]: unknown
}

/** An old-style folder-tree node: its own books plus named subfolders. */
export interface FixtureTree<B extends FixtureBook = FixtureBook> {
  books: B[]
  folders: Record<string, FixtureTree<B>>
}

/**
 * The shelf's paged lists as the components read them. The fixture books stand
 * in for real ones, so they are typed as what the shelf expects.
 */
export type FixtureShelfPages<B> = ShelfPages & PagedLists<B>

export interface ShelfFixtureOptions {
  depth?: number
  sort?: string
  order?: string
}

function subfolder(book: FixtureBook, depth: number): string {
  const parts = (book.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > depth + 2 ? parts.slice(depth + 1, -1).join('/') : ''
}

function dirOf(book: FixtureBook): string {
  return (book.relative_path || '').replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

/**
 * A paged-lists object (see usePagedLists) holding `lists` fully loaded.
 *
 * Only `lists` and `get` exist - all a component under test reads - but it is
 * typed as the full hook result so it can be passed wherever one is expected.
 */
export function loadedPages<T>(lists: Record<string, T[]>): PagedLists<T> {
  return {
    lists,
    get: (key: string) =>
      lists[key]
        ? { items: lists[key], total: lists[key].length, hasMore: false, loading: false }
        : undefined,
  } as unknown as PagedLists<T>
}

/**
 * `{ shelf, pages }` for `books`: the category roots (shelfTree nodes) and every
 * node's own books, sorted the way the server would send them.
 */
export function shelfFromBooks<B extends FixtureBook>(
  books: B[],
  { depth = 2, sort = 'title', order = 'asc' }: ShelfFixtureOptions = {}
): { shelf: Record<string, ShelfNode>; pages: FixtureShelfPages<B> } {
  const rows = new Map<string, Schema<'ShelfFolderGroup'>>()
  const lists: Record<string, B[]> = {}
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
  return {
    shelf: buildShelf([...rows.values()], sort, order),
    pages: loadedPages(lists) as unknown as FixtureShelfPages<B>,
  }
}

/**
 * A shelfTree node (plus its loaded books) from an old-style folder-tree node
 * (`{ books, folders: { name -> node } }`), for tests that describe a folder by
 * its contents.
 */
export function shelfNodeFromTree<B extends FixtureBook>(
  tree: FixtureTree<B>,
  {
    category,
    name,
    path,
    sort = 'title',
    order = 'asc',
  }: { category: string; name: string; path: string; sort?: string; order?: string }
): { node: ShelfNode; pages: FixtureShelfPages<B> } {
  const lists: Record<string, B[]> = {}
  const cmp = shelfComparator(sort, order)
  const field = SORT_FIELDS[sort] || 'title'
  const build = (node: FixtureTree<B>, nodeName: string, nodePath: string): ShelfNode => {
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
    const first =
      field === 'title' || !books.length
        ? null
        : (((books[0] as Record<string, unknown>)[field] ?? null) as ShelfNode['first'])
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
  return {
    node: build(tree, name, path),
    pages: loadedPages(lists) as unknown as FixtureShelfPages<B>,
  }
}
