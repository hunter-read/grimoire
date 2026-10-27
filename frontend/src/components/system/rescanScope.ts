/** Rescan-scope helpers for a system's books.
 *
 *  A scope is a library-root-relative folder path the backend re-scans. Each
 *  helper takes the system's category `depth` (see `categoryDepth` in
 *  folderTree.js): 2 for an ordinary system, 3 for one nested in a container
 *  folder, where every path index shifts by the container segment.
 *
 *  Extracted from SystemDetailView so the path arithmetic is unit-testable. */

/** The library-root-relative folder a book lives in (its relative_path minus the
 *  filename), e.g. "books/D&D 5e/adventure/Curse of Strahd". */
export function bookFolderScope(book) {
  const parts = (book.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.slice(0, -1).join('/')
}

/** The "books/{SystemName}" scope for a whole system, derived from any of its books.
 *
 *  A system nested in a container is "books/{Container}/{SystemName}": the scope
 *  has to include its own folder, or a rescan of one edition would re-scan every
 *  edition in the container (the backend reads the segment after the container
 *  as the child to scope to). */
export function systemScope(books, depth = 2) {
  const ref = (books || []).find((b) => b.relative_path)
  if (!ref) return null
  const parts = ref.relative_path.replace(/\\/g, '/').split('/')
  return parts.length >= depth ? parts.slice(0, depth).join('/') : null
}

/** The deepest common folder scope shared by a group of books (their category or
 *  subfolder dir). Falls back to the system scope when paths diverge. */
export function groupScope(books, depth = 2) {
  const dirs = (books || []).map(bookFolderScope).filter(Boolean)
  if (dirs.length === 0) return null
  const split = dirs.map((d) => d.split('/'))
  const common = []
  for (let i = 0; i < split[0].length; i++) {
    const seg = split[0][i]
    if (split.every((p) => p[i] === seg)) common.push(seg)
    else break
  }
  // Anything shallower than the system's own folder is not a usable scope.
  return common.length >= depth ? common.join('/') : systemScope(books, depth)
}
