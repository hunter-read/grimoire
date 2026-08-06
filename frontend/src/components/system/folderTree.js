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
 *  is 2 for an ordinary system and 3 for a container child. Deriving it from the
 *  path is not reliable: a keyword-inferred category stores a slug that doesn't
 *  match its folder name ("Core Rulebooks" → `core`), so the segment can't be
 *  found by matching the book's category. */
export function categoryDepth(system) {
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
