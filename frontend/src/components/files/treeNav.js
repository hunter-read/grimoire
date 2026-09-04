/**
 * Keyboard traversal of the file manager's flattened tree.
 *
 * `useLibraryPane` flattens the loaded tree into a `rows` array of either
 * `{ entry, depth, isOpen }` or `{ placeholder, path, depth }`. Placeholder rows
 * report the state of an expanded subfolder — loading, empty, errored, or
 * truncated — and occupy an index, but they are not things a cursor can sit on.
 *
 * All of this is pure and lives apart from the pane for two reasons: the
 * arithmetic is the fiddly part of keyboard navigation and deserves tests that
 * do not need a DOM, and the same walk is wanted by both the key handler and the
 * range-selection helper.
 */

/** Whether a row is one the cursor can land on. */
const selectable = (row) => !!row?.entry

/** Index of the row holding `path`, or -1. */
export function indexOfPath(rows, path) {
  if (path == null) return -1
  return rows.findIndex((row) => row.entry?.path === path)
}

/**
 * Nearest selectable row at or after `from`, walking in `dir` (+1 or -1).
 *
 * Returns -1 when the walk runs off the end, which every caller treats as "stay
 * put" — arrowing past the last row should do nothing rather than wrap, since
 * wrapping in a tree of thousands of rows loses the user's place completely.
 */
export function nextSelectable(rows, from, dir) {
  for (let i = from; i >= 0 && i < rows.length; i += dir) {
    if (selectable(rows[i])) return i
  }
  return -1
}

/**
 * Index of the row that contains `rows[i]`, or -1 at the top level.
 *
 * Found by walking backwards to the first *selectable* row of smaller depth.
 * Placeholders are skipped rather than compared: a `truncated` row sits at the
 * end of a folder's children carrying the children's depth, so a naive depth
 * comparison would mistake it for the parent.
 */
export function parentIndex(rows, i) {
  const row = rows[i]
  if (!row) return -1
  for (let j = i - 1; j >= 0; j--) {
    const candidate = rows[j]
    if (selectable(candidate) && candidate.depth < row.depth) return j
  }
  return -1
}

/**
 * What ArrowRight should do at row `i`.
 *
 * Finder semantics: a closed folder opens, an open one descends into its first
 * child, and a file does nothing.
 *
 * The descent is guarded on depth. An expanded folder that is empty, still
 * loading, or errored shows a *placeholder* as its only child, so skipping to
 * the next selectable row would land on the folder's next **sibling** — an
 * arrow-right that silently jumps past the thing it just opened.
 */
export function rightTarget(rows, i) {
  const row = rows[i]
  if (!row?.entry?.is_dir) return null
  if (!row.isOpen) return { action: 'expand', path: row.entry.path }
  const child = nextSelectable(rows, i + 1, 1)
  if (child === -1 || rows[child].depth <= row.depth) return null
  return { action: 'move', index: child }
}

/**
 * What ArrowLeft should do at row `i`.
 *
 * Finder semantics: an open folder closes; anything else steps out to its
 * parent. At the top level with nothing to close there is nowhere to go.
 */
export function leftTarget(rows, i) {
  const row = rows[i]
  if (!row?.entry) return null
  if (row.entry.is_dir && row.isOpen) return { action: 'collapse', path: row.entry.path }
  const parent = parentIndex(rows, i)
  return parent === -1 ? null : { action: 'move', index: parent }
}

/**
 * Every selectable path between two rows, inclusive, in display order.
 *
 * Used for shift-range selection. Order of the arguments does not matter: the
 * anchor may sit below the cursor as easily as above it.
 */
export function rangeBetween(rows, fromPath, toPath) {
  const a = indexOfPath(rows, fromPath)
  const b = indexOfPath(rows, toPath)
  if (a === -1 || b === -1) return []
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return rows
    .slice(lo, hi + 1)
    .filter(selectable)
    .map((row) => row.entry.path)
}
