import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { files as filesApi } from '../api'
import { rangeBetween } from '../components/files/treeNav'

/**
 * State for one pane of the library file manager (issue #302).
 *
 * The pane is a **tree**, not a single folder listing. Reorganising a library
 * means comparing places that are several levels apart — a book in
 * `books/D&D 5e/core` belongs under `books/D&D 5e/adventures` — and a flat
 * browser makes you navigate away from the source to see the destination, which
 * is exactly when a drag becomes impossible. Expanding folders in place keeps
 * both ends of the move on screen.
 *
 * So this holds a cache of every folder that has been loaded (`folders`, keyed
 * by path) plus the set of expanded paths, and derives the visible rows from the
 * two. The root path stays the pane's anchor: collapsing everything returns you
 * to a plain listing of it.
 *
 * Selection is keyed by full path, so it survives expanding and collapsing —
 * unlike navigation, where the old behaviour of clearing was right because the
 * items genuinely left the screen.
 */
export function useLibraryPane(initialPath = '') {
  const [path, setPath] = useState(initialPath)
  // path -> { entries, writable, parent, loading, error }
  const [folders, setFolders] = useState({})
  const [expanded, setExpanded] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())
  // The keyboard cursor: the row arrow keys act on. Held as a *path* rather than
  // a row index because every expand, collapse, refresh and sibling delete
  // renumbers the rows — the same reason `selected` is keyed by path.
  const [cursor, setCursor] = useState(null)
  // Where a shift-range measures from. A ref, not state: it only ever changes
  // alongside a selection change that already re-renders.
  const anchor = useRef(null)
  // Guards against two loads racing for the same folder (an expand arriving
  // while a refresh is already in flight).
  const inFlight = useRef(new Set())

  const load = useCallback(async (target) => {
    if (inFlight.current.has(target)) return
    inFlight.current.add(target)
    setFolders((prev) => ({
      ...prev,
      [target]: { ...(prev[target] || {}), loading: true, error: null },
    }))
    try {
      const res = await filesApi.browse(target)
      setFolders((prev) => ({
        ...prev,
        [target]: {
          entries: res.entries || [],
          writable: res.writable,
          parent: res.parent ?? null,
          total: res.total ?? (res.entries || []).length,
          truncated: !!res.truncated,
          singletonsTaken: res.singletons_taken || {},
          loading: false,
          error: null,
        },
      }))
    } catch (e) {
      setFolders((prev) => ({
        ...prev,
        [target]: {
          entries: [],
          writable: false,
          parent: prev[target]?.parent ?? null,
          loading: false,
          error: e.message || 'Could not read that folder',
        },
      }))
    } finally {
      inFlight.current.delete(target)
    }
  }, [])

  // Load the root whenever the pane is re-anchored.
  useEffect(() => {
    load(path)
  }, [path, load])

  const navigate = useCallback((next) => {
    const target = next ?? ''
    setPath(target)
    // Navigating is a change of context: drop expansion and selection, which
    // both refer to places that are no longer on screen.
    setExpanded(new Set())
    setSelected(new Set())
    setCursor(null)
    anchor.current = null
  }, [])

  /**
   * Expand or collapse a folder in place.
   *
   * Collapsing keeps the cached entries so re-expanding is instant; only the
   * expanded set changes. Expanding loads on first open and then reuses the
   * cache, so toggling a folder repeatedly does not re-hit the API.
   */
  const toggleExpand = useCallback(
    (folderPath) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(folderPath)) {
          next.delete(folderPath)
        } else {
          next.add(folderPath)
        }
        return next
      })
      setFolders((prev) => {
        if (!prev[folderPath]) load(folderPath)
        return prev
      })
    },
    [load]
  )

  /** Expand a folder without collapsing it if already open (used by drag-hover). */
  const expand = useCallback(
    (folderPath) => {
      let needsLoad = false
      setExpanded((prev) => {
        if (prev.has(folderPath)) return prev
        const next = new Set(prev)
        next.add(folderPath)
        return next
      })
      setFolders((prev) => {
        if (!prev[folderPath]) needsLoad = true
        return prev
      })
      if (needsLoad) load(folderPath)
    },
    [load]
  )

  // Re-fetch every folder currently on screen. After a move, the source and the
  // destination have both changed, and either may be an expanded subfolder
  // rather than the pane root.
  const refresh = useCallback(() => {
    const targets = new Set([path, ...expanded])
    targets.forEach((target) => load(target))
  }, [load, path, expanded])

  /**
   * Refresh one folder and make sure its contents are on screen.
   *
   * `refresh` only re-reads what is already loaded, which is right after a move
   * but wrong after a *create*: a new folder made inside a collapsed parent
   * lands in a folder the pane has never loaded, so nothing changes and the
   * folder looks like it was never made. Expanding the parent — and reloading it
   * even when it was already open — is what actually reveals the new row.
   *
   * The pane root is refreshed rather than expanded, since it is already the
   * thing on screen and has no disclosure triangle of its own.
   */
  const refreshPath = useCallback(
    (target) => {
      const folderPath = target ?? ''
      if (folderPath !== path) {
        setExpanded((prev) => {
          if (prev.has(folderPath)) return prev
          const next = new Set(prev)
          next.add(folderPath)
          return next
        })
      }
      // Bypass the in-flight guard: a listing fetched before the folder was
      // created would not contain it, so reusing that request would show a
      // stale folder and look like the create silently failed.
      inFlight.current.delete(folderPath)
      load(folderPath)
    },
    [load, path]
  )

  const toggle = useCallback((entryPath) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(entryPath)) next.delete(entryPath)
      else next.add(entryPath)
      return next
    })
  }, [])

  const selectOnly = useCallback((entryPath) => setSelected(new Set([entryPath])), [])
  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setCursor(null)
    anchor.current = null
  }, [])

  const root = folders[path]

  /**
   * Flatten the loaded tree into the rows to render, depth-first.
   *
   * Each row carries its `depth` so the list can indent it. Only expanded
   * folders contribute children, and a folder still loading contributes a
   * placeholder row rather than nothing — otherwise expanding a slow folder
   * looks like it did nothing at all.
   */
  const rows = useMemo(() => {
    const out = []
    const walk = (folderPath, depth) => {
      const folder = folders[folderPath]
      // A folder that is mid-load has a state object but no entries yet, so this
      // must tolerate the missing array rather than assume it.
      if (!folder?.entries) return
      for (const entry of folder.entries) {
        const isOpen = entry.is_dir && expanded.has(entry.path)
        out.push({ entry, depth, isOpen })
        if (isOpen) {
          const child = folders[entry.path]
          if (!child || (child.loading && !child.entries?.length)) {
            out.push({ placeholder: 'loading', path: entry.path, depth: depth + 1 })
          } else if (child?.error) {
            out.push({
              placeholder: 'error',
              path: entry.path,
              depth: depth + 1,
              text: child.error,
            })
          } else if (child.entries.length === 0) {
            out.push({ placeholder: 'empty', path: entry.path, depth: depth + 1 })
          } else {
            walk(entry.path, depth + 1)
            // A folder too large to send in full says so at the end of its
            // children, rather than presenting a truncated list as the whole
            // thing.
            if (child?.truncated) {
              out.push({
                placeholder: 'truncated',
                path: entry.path,
                depth: depth + 1,
                shown: child.entries.length,
                total: child.total,
              })
            }
          }
        }
      }
    }
    walk(path, 0)
    const rootFolder = folders[path]
    if (rootFolder?.truncated) {
      out.push({
        placeholder: 'truncated',
        path,
        depth: 0,
        shown: rootFolder.entries.length,
        total: rootFolder.total,
      })
    }
    return out
  }, [folders, expanded, path])

  const selectAll = useCallback(() => {
    setSelected(new Set(rows.filter((r) => r.entry).map((r) => r.entry.path)))
  }, [rows])

  /**
   * Move the keyboard cursor to `path`, and by default select it.
   *
   * Three behaviours in one call, because they are the three things an arrow key
   * can mean:
   *
   *  * plain arrow — move and replace the selection, re-anchoring a future range
   *    here (the Finder default, and what a click does too);
   *  * `extend` — keep the anchor and select everything between it and here;
   *  * `select: false` — move the cursor alone, leaving the selection untouched,
   *    which is how a discontiguous selection gets built.
   */
  const cursorTo = useCallback(
    (entryPath, { extend = false, select = true } = {}) => {
      if (entryPath == null) return
      setCursor(entryPath)
      if (extend && anchor.current) {
        const range = rangeBetween(rows, anchor.current, entryPath)
        // An anchor that has scrolled out of the loaded tree yields nothing;
        // falling back to a plain selection beats selecting nothing at all.
        setSelected(new Set(range.length ? range : [entryPath]))
        return
      }
      if (!select) return
      setSelected(new Set([entryPath]))
      anchor.current = entryPath
    },
    [rows]
  )

  // A cursor whose row has left the tree — its parent was collapsed, the file
  // was moved away, the pane was refreshed — points at nothing. Dropping it is
  // better than snapping to a neighbour, which moves the user somewhere they did
  // not ask to go. Collapsing with ArrowLeft sidesteps this by moving the cursor
  // to the parent *before* it closes.
  useEffect(() => {
    if (cursor && !rows.some((r) => r.entry?.path === cursor)) setCursor(null)
  }, [rows, cursor])

  return {
    path,
    rows,
    entries: root?.entries || [],
    writable: root?.writable ?? false,
    parent: root?.parent ?? null,
    loading: root?.loading ?? true,
    error: root?.error ?? null,
    // Which one-of-a-kind collections already exist, keyed by kind. Used to
    // hide container options the API would refuse.
    singletonsTaken: root?.singletonsTaken || {},
    folders,
    expanded,
    selected,
    navigate,
    refresh,
    refreshPath,
    toggle,
    toggleExpand,
    expand,
    selectOnly,
    clearSelection,
    selectAll,
    cursor,
    cursorTo,
    // `writable` for an arbitrary folder, so a drop target deep in the tree can
    // be validated without assuming the root's permissions.
    isWritable: (folderPath) => folders[folderPath]?.writable ?? root?.writable ?? false,
  }
}

export default useLibraryPane
