import { bookComparator } from '../library/applyBookSortFilter'

/** Nested-subfolder tree helpers shared by SystemCategorySection and BookFolderGroup.
 *  Supports arbitrarily deep folder nesting under a category (issue #189). */

/** Index of the category folder within a book's path segments.
 *
 *  Normally `books/{System}/{categoryDir}/…` puts the category at index 2. A
 *  system nested inside a container folder is one level deeper —
 *  `books/{Container}/{System}/{categoryDir}/…` (issues #261/#262) — so its
 *  category sits at index 3 and everything below it shifts too.
 *
 *  This mirrors the indexer's `system_depth` argument to `guess_category`, which
 *  is `2 + <enclosing containers>`. Deriving it from the path is not reliable: a
 *  keyword-inferred category stores a slug that doesn't match its folder name
 *  ("Core Rulebooks" → `core`), so the segment can't be found by matching the
 *  book's category.
 *
 *  The server sends `category_depth` because containers nest (issue #301) and
 *  the payload carries only the immediate `parent_id`, not the whole chain — so
 *  a system two containers deep can't be told from one at a depth of 3 here
 *  (issue #357). `parent_id` is the fallback for a payload predating the field. */
export function categoryDepth(system) {
  if (Number.isInteger(system?.category_depth)) return system.category_depth
  return system?.parent_id ? 3 : 2
}

/** Extract the (possibly nested) subfolder path segments from a book's relative_path.
 *  Path structure: books/{SystemName}/{categoryDir}/{sub...}/book.pdf
 *  Returns the segments after the category dir and before the filename, e.g.
 *  ["monsters", "spelljammer"], or [] when the book sits directly in the category dir.
 *
 *  `depth` is the index of the category folder (see `categoryDepth`); pass the
 *  system's so container children don't treat their own folder as the category. */
export function getBookSubfolderPath(book, depth = 2) {
  const parts = (book.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > depth + 2 ? parts.slice(depth + 1, -1) : []
}

/** Build a nested folder tree from a category's books.
 *  Each node: { books: [], folders: { name -> node } }. Books directly in the
 *  category dir (empty subfolder path) collect at the root node's `books`. */
export function buildFolderTree(books, depth = 2) {
  const root = { books: [], folders: {} }
  for (const book of books) {
    const segs = getBookSubfolderPath(book, depth)
    let node = root
    for (const seg of segs) {
      if (!node.folders[seg]) node.folders[seg] = { books: [], folders: {} }
      node = node.folders[seg]
    }
    node.books.push(book)
  }
  return root
}

/** Total number of books at or below a tree node (recursive). */
export function countBooks(node) {
  return (
    node.books.length +
    Object.values(node.folders).reduce((sum, child) => sum + countBooks(child), 0)
  )
}

/** All books at or below a folder-tree node, in tree order (own books first,
 *  then child folders alphabetically). */
export function allBooks(node) {
  return [
    ...node.books,
    ...Object.keys(node.folders)
      .sort((a, b) => a.localeCompare(b))
      .flatMap((name) => allBooks(node.folders[name])),
  ]
}

/** A node's direct children in display order: `{ type: 'folder', name, node }`
 *  and `{ type: 'book', book }` entries, applied identically at every level so a
 *  category and the folders inside it never disagree about where folders go.
 *
 *  A folder sorts as a stand-in book. Sorting by title, the stand-in is titled
 *  with the folder's name; sorting by anything else (year, pages, size) a
 *  folder has no value of its own, so it takes the value of whichever of its
 *  books sorts first. Folders therefore follow the sort and its direction in
 *  either placement, and in `mixed` a folder whose name falls between two books
 *  lands between them. On a tie the folder goes first. */
export function orderedEntries(node, { sort = 'title', order = 'asc', placement = 'first' } = {}) {
  // placement: 'first' pulls every folder ahead of the loose books; 'mixed'
  // sorts them in among the books as though each were one more entry.
  const cmp = bookComparator(sort, order)
  const standIn = (name, child) =>
    sort === 'title' ? { title: name } : [...allBooks(child)].sort(cmp)[0]
  const folders = Object.entries(node.folders)
    .map(([name, child]) => ({ type: 'folder', name, node: child, key: standIn(name, child) }))
    .sort((a, b) => cmp(a.key, b.key) || a.name.localeCompare(b.name))
  const books = [...node.books].sort(cmp).map((book) => ({ type: 'book', book, key: book }))
  if (placement !== 'mixed') return [...folders, ...books]
  // Both lists are already in order, so merge rather than re-sort.
  const out = []
  let f = 0
  let b = 0
  while (f < folders.length || b < books.length) {
    if (b >= books.length || (f < folders.length && cmp(folders[f].key, books[b].key) <= 0)) {
      out.push(folders[f++])
    } else {
      out.push(books[b++])
    }
  }
  return out
}

/** Every book at or below a node in on-screen order — the order `orderedEntries`
 *  renders, flattened. Shift-click range selection walks this, so the range it
 *  picks is the one the user sees. */
export function orderedBooks(node, opts) {
  return orderedEntries(node, opts).flatMap((entry) =>
    entry.type === 'book' ? [entry.book] : orderedBooks(entry.node, opts)
  )
}

/** `orderedEntries` with each stretch of consecutive books gathered into one
 *  `{ type: 'books', books }` run, so a run renders in a single grid/list
 *  container and folders sit between runs. Folder entries pass through. */
export function entryRuns(entries) {
  const runs = []
  for (const entry of entries) {
    if (entry.type === 'folder') {
      runs.push(entry)
    } else if (runs.at(-1)?.type === 'books') {
      runs.at(-1).books.push(entry.book)
    } else {
      runs.push({ type: 'books', books: [entry.book] })
    }
  }
  return runs
}
