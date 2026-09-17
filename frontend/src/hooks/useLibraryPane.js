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
  // The cursor's last known neighbours, recorded while its row is still in the
  // tree, and whether a cursor that leaves the tree should fall back to one of
  // them. See the pair of effects below `cursorTo`.
  const neighbours = useRef(null)
  const keepCursor = useRef(true)
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
          categoryHost: !!res.category_host,
          childrenAcceptContainerKind: !!res.children_accept_container_kind,
          childrenAcceptFramesMarker: !!res.children_accept_frames_marker,
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
          categoryHost: false,
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
          // Collapsing hides rows rather than removing them from the tree, so a
          // cursor inside the subtree has no surviving neighbour to fall back
          // to — drop it instead of snapping somewhere unrelated.
          keepCursor.current = false
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

  // Record the cursor's neighbours while its row is still in the tree: once the
  // row has gone, the rows array can no longer answer "what was next to it".
  useEffect(() => {
    const i = rows.findIndex((r) => r.entry?.path === cursor)
    if (i === -1) return
    const at = (from, dir) => {
      for (let j = from; j >= 0 && j < rows.length; j += dir) {
        if (rows[j].entry) return rows[j].entry.path
      }
      return null
    }
    // Previous first: a deleted row's predecessor is the one that keeps the
    // user's place, since everything below has shifted up into the gap.
    neighbours.current = { prev: at(i - 1, -1), next: at(i + 1, 1) }
  }, [rows, cursor])

  // A cursor whose row has left the tree — the file was renamed, deleted, or
  // moved away — points at nothing. Land on the nearest surviving neighbour
  // instead of dropping it: after deleting a file the user is usually deleting
  // its siblings too, and a dropped cursor sends them back to the top of the
  // list (issue #460).
  //
  // A cursor lost to a *collapse* is the exception — its neighbours are the
  // collapsed subtree, which is equally gone. `pruneCursor` skips the fallback
  // for that case, and ArrowLeft sidesteps it entirely by moving the cursor to
  // the parent before closing.
  useEffect(() => {
    if (!cursor || rows.some((r) => r.entry?.path === cursor)) return
    const { prev, next } = neighbours.current || {}
    const fallback = keepCursor.current ? prev || next : null
    keepCursor.current = true
    // Only the cursor moves. Re-selecting would silently make the next bulk
    // action act on a row the user never picked.
    setCursor(fallback && rows.some((r) => r.entry?.path === fallback) ? fallback : null)
  }, [rows, cursor])

  /** Drop the cursor outright the next time its row leaves the tree. */
  const pruneCursor = useCallback(() => {
    keepCursor.current = false
  }, [])

  // A path the cursor should land on as soon as it exists. A rename replaces the
  // row rather than removing it, so the neighbour fallback above would leave the
  // user beside the file they just renamed instead of on it — but the new row
  // only appears once the refresh lands, which is several renders later.
  const pending = useRef(null)
  const cursorWhenReady = useCallback((entryPath) => {
    pending.current = entryPath
  }, [])

  useEffect(() => {
    const target = pending.current
    if (!target) return
    if (!rows.some((r) => r.entry?.path === target)) return
    pending.current = null
    setCursor(target)
    setSelected(new Set([target]))
    anchor.current = target
  }, [rows])

  return {
    path,
    rows,
    entries: root?.entries || [],
    writable: root?.writable ?? false,
    // Whether the standard category folders belong directly inside the folder
    // this pane is anchored on — what decides if its background menu offers to
    // scaffold them.
    categoryHost: root?.categoryHost ?? false,
    // Whether a folder created inside this one could declare a container kind
    // or a frame marker — what the toolbar's "new folder" offers, since it acts
    // on the anchored folder and has no row to read the flags from.
    childrenAcceptContainerKind: root?.childrenAcceptContainerKind ?? false,
    childrenAcceptFramesMarker: root?.childrenAcceptFramesMarker ?? false,
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
    pruneCursor,
    cursorWhenReady,
    // `writable` for an arbitrary folder, so a drop target deep in the tree can
    // be validated without assuming the root's permissions.
    isWritable: (folderPath) => folders[folderPath]?.writable ?? root?.writable ?? false,
  }
}

export default useLibraryPane
