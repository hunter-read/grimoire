// The system shelf's folder tree, built from server-side groups (issue #221).
//
// The detail view used to receive every book and build its category/subfolder
// tree in the browser (folderTree.js). Now `/systems/{id}/book-groups` reports
// which (category, subfolder) pairs hold matching books and how many, and each
// node fetches its own books a page at a time. These helpers turn that report
// into the same tree shape - folders nested by path segment - and decide where
// folders sit among a node's books, using only what the server sent plus the
// books loaded so far.

import type { Schema } from '../../api'

/** What the shelf comparator reads of a book (or a folder's stand-in). */
export interface ShelfSortable {
  title?: string | null
  product_code?: string | null
}

/** A category or subfolder of the shelf, as `buildShelf` builds it. */
export interface ShelfNode {
  category: string
  name: string
  path: string
  /** Books sitting directly in this node. */
  direct: number
  /** Books at or below this node. */
  count: number
  /** The library directories the node stands for (rescan scopes). */
  dirs: string[]
  /** The sort value of the node's first own book. */
  first: number | string | null | undefined
  folders: Record<string, ShelfNode>
}

/** A node's direct child, as `orderedNodeEntries` lists it. */
export type ShelfEntry<B> =
  | { type: 'folder'; name: string; node: ShelfNode; key: ShelfSortable }
  | { type: 'book'; book: B; key: ShelfSortable }

/** How `orderedNodeEntries` sorts and places folders. */
export interface ShelfOrderOptions {
  sort?: string
  order?: string
  placement?: string
  hasMore?: boolean
}

/** A folder's stand-in: its sort field's value (whichever field that is) and its name. */
export type ShelfStandIn = ShelfSortable & Record<string, unknown>

type Comparator = (a: ShelfSortable, b: ShelfSortable) => number

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// The book field each sort reads - the same field a folder's stand-in carries.
export const SORT_FIELDS: Record<string, string> = {
  title: 'title',
  year: 'year',
  page_count: 'page_count',
  size: 'file_size',
  product_code: 'product_code',
  added_at: 'added_at',
}

/** The paged-list key for one node's own books. */
export const nodeKey = (category: string, path: string): string => `${category}\u0000${path}`

/** `nodeKey`'s inverse. */
export const splitNodeKey = (key: string): [string, string] => {
  const cut = key.indexOf('\u0000')
  return [key.slice(0, cut), key.slice(cut + 1)]
}

const blank = (v: unknown): v is null | undefined | '' => v === null || v === undefined || v === ''

/**
 * Comparator matching the server's ORDER BY for the shelf (routers/systems/
 * books.py), so a folder's stand-in and the books around it are compared the
 * way the server ordered them: titles naturally, undated and unnumbered books
 * last whichever way the list runs, books without a product code last.
 */
export function shelfComparator(sort = 'title', order = 'asc'): Comparator {
  const dir = order === 'desc' ? -1 : 1
  const field = SORT_FIELDS[sort] || 'title'
  const byTitle: Comparator = (a, b) => dir * collator.compare(a.title || '', b.title || '')
  if (field === 'title') return byTitle
  if (field === 'product_code') {
    return (a: ShelfSortable, b: ShelfSortable) => {
      const ca = a.product_code || ''
      const cb = b.product_code || ''
      if (!ca !== !cb) return ca ? -1 : 1
      return (ca && dir * collator.compare(ca, cb)) || byTitle(a, b)
    }
  }
  const nullsLast = field === 'year' || field === 'added_at'
  return (a: ShelfSortable, b: ShelfSortable) => {
    let va = (a as Record<string, unknown>)[field]
    let vb = (b as Record<string, unknown>)[field]
    if (nullsLast && (blank(va) || blank(vb))) {
      if (blank(va) && blank(vb)) return byTitle(a, b)
      return blank(va) ? 1 : -1
    }
    if (field === 'added_at') {
      va = Date.parse(va as string)
      vb = Date.parse(vb as string)
    } else {
      va = va || 0
      vb = vb || 0
    }
    return dir * ((va as number) - (vb as number)) || byTitle(a, b)
  }
}

const newNode = (category: string, name: string, path: string): ShelfNode => ({
  category,
  name,
  path,
  direct: 0,
  count: 0,
  dirs: [],
  first: null,
  folders: {},
})

/**
 * `{ [category]: rootNode }` from the `/book-groups` rows.
 *
 * A node is `{ category, name, path, direct, count, dirs, first, folders }`:
 * `direct` books sit in it, `count` at or below it; `dirs` are the library
 * directories it stands for (rescan scopes); `first` the sort value of its
 * first own book. A row for "Monsters/Deep" creates "Monsters" too, empty if
 * nothing sits directly in it, as buildFolderTree did.
 */
export function buildShelf(
  groups: Schema<'ShelfFolderGroup'>[] = [],
  sort = 'title',
  order = 'asc'
): Record<string, ShelfNode> {
  const cmp = shelfComparator(sort, order)
  const field = SORT_FIELDS[sort] || 'title'
  const roots: Record<string, ShelfNode> = {}
  for (const g of groups) {
    const category = g.category || 'core'
    if (!roots[category]) roots[category] = newNode(category, '', '')
    let node = roots[category]
    const segments = g.path ? g.path.split('/') : []
    segments.forEach((seg, i) => {
      if (!node.folders[seg]) {
        node.folders[seg] = newNode(category, seg, segments.slice(0, i + 1).join('/'))
      }
      node = node.folders[seg]
    })
    node.direct += g.count
    if (g.dir) node.dirs.push(g.dir)
    if (!blank(g.first) && field !== 'title') {
      const candidate = { [field]: g.first }
      if (blank(node.first) || cmp(candidate, { [field]: node.first } as ShelfSortable) < 0)
        node.first = g.first
    }
  }
  const total = (node: ShelfNode): number => {
    node.count = node.direct + Object.values(node.folders).reduce((n, c) => n + total(c), 0)
    return node.count
  }
  Object.values(roots).forEach(total)
  return roots
}

/**
 * What a folder sorts as among books: its name for the title sort, otherwise
 * the value of the first book anywhere beneath it.
 */
export function standIn(node: ShelfNode, sort = 'title', order = 'asc'): ShelfStandIn {
  const field = SORT_FIELDS[sort] || 'title'
  if (field === 'title') return { title: node.name }
  const cmp = shelfComparator(sort, order)
  let best: ShelfStandIn | null = blank(node.first)
    ? null
    : { [field]: node.first, title: node.name }
  for (const child of Object.values(node.folders)) {
    const sub = standIn(child, sort, order)
    if (blank(sub[field])) continue
    if (!best || cmp(sub, best) < 0) best = { [field]: sub[field], title: node.name }
  }
  return best || { [field]: null, title: node.name }
}

/**
 * A node's children in display order: `{ type: 'folder', name, node }` and
 * `{ type: 'book', book }` entries, given the books loaded so far.
 *
 * `placement` 'first' puts every folder ahead of the books. 'mixed' sorts each
 * folder in among the books by its stand-in - and while more books are still
 * to load, a folder that would sort after the last loaded book is held back
 * until the books before it have arrived, so pages landing never reshuffle
 * what is already on screen.
 */
export function orderedNodeEntries<B extends ShelfSortable>(
  node: ShelfNode,
  books: B[] = [],
  { sort = 'title', order = 'asc', placement = 'first', hasMore = false }: ShelfOrderOptions = {}
): ShelfEntry<B>[] {
  const cmp = shelfComparator(sort, order)
  const folders = Object.values(node.folders)
    .map((child) => ({
      type: 'folder' as const,
      name: child.name,
      node: child,
      key: standIn(child, sort, order),
    }))
    .sort((a, b) => cmp(a.key, b.key) || collator.compare(a.name, b.name))
  const bookEntries = books.map((book) => ({ type: 'book' as const, book, key: book }))
  if (placement !== 'mixed') return [...folders, ...bookEntries]
  const out: ShelfEntry<B>[] = []
  let f = 0
  let b = 0
  while (f < folders.length || b < bookEntries.length) {
    if (b >= bookEntries.length) {
      if (hasMore) break
      out.push(folders[f++])
    } else if (f < folders.length && cmp(folders[f].key, bookEntries[b].key) <= 0) {
      out.push(folders[f++])
    } else {
      out.push(bookEntries[b++])
    }
  }
  return out
}

/** Every directory at or below a node. */
export function nodeDirs(node: ShelfNode): string[] {
  return [...node.dirs, ...Object.values(node.folders).flatMap(nodeDirs)]
}

/**
 * The rescan scope for a node: the deepest directory its books share, or
 * `fallback` (the system's own folder) when they diverge above `depth`.
 * Mirrors groupScope in rescanScope.js, from directories rather than books.
 */
export function nodeScope(
  node: ShelfNode,
  depth = 2,
  fallback: string | null = null
): string | null {
  const dirs = nodeDirs(node).filter(Boolean)
  if (dirs.length === 0) return fallback
  const split = dirs.map((d) => d.split('/'))
  const common: string[] = []
  for (let i = 0; i < split[0].length; i++) {
    const seg = split[0][i]
    if (split.every((p) => p[i] === seg)) common.push(seg)
    else break
  }
  return common.length >= depth ? common.join('/') : fallback
}

/** The category folder's own name ("GM Tools"), from any directory under it. */
export function categoryFolderName(node: ShelfNode, depth = 2): string | null {
  const dir = nodeDirs(node).find((d) => d.split('/').length > depth)
  return dir ? dir.split('/')[depth] : null
}
