/** Nested-subfolder tree helpers shared by SystemCategorySection and BookFolderGroup.
 *  Supports arbitrarily deep folder nesting under a category (issue #189). */

/** Extract the (possibly nested) subfolder path segments from a book's relative_path.
 *  Path structure: books/{SystemName}/{categoryDir}/{sub...}/book.pdf
 *  Returns the segments after the category dir and before the filename, e.g.
 *  ["monsters", "spelljammer"], or [] when the book sits directly in the category dir. */
export function getBookSubfolderPath(book) {
  const parts = (book.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.length > 4 ? parts.slice(3, -1) : []
}

/** Build a nested folder tree from a category's books.
 *  Each node: { books: [], folders: { name -> node } }. Books directly in the
 *  category dir (empty subfolder path) collect at the root node's `books`. */
export function buildFolderTree(books) {
  const root = { books: [], folders: {} }
  for (const book of books) {
    const segs = getBookSubfolderPath(book)
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
