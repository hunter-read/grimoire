import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuChevronRight,
  LuArrowUp,
  LuTriangleAlert,
  LuLock,
  LuX,
  LuFolderPlus,
} from 'react-icons/lu'
import Spinner from '../Spinner'
import FileRow from './FileRow'
import useVirtualRows from '../../hooks/useVirtualRows'
import { indexOfPath, nextSelectable, rightTarget, leftTarget } from './treeNav'

// Drag payloads are JSON so a drop can carry several paths at once (a
// multi-select drag) plus the pane it came from, which the drop handler needs to
// know whether the move is a no-op within one folder.
export const DRAG_MIME = 'application/x-grimoire-paths'

// Every row is exactly this tall. The tree is virtualised, and a uniform height
// is what lets the visible window be computed arithmetically instead of measured
// — the difference between a constant-cost render and one that walks 100,000
// rows. Keep this in sync with FileRow's `height`.
export const ROW_HEIGHT = 30

// How long a drag must hover a collapsed folder before it springs open. Long
// enough that passing over a folder on the way somewhere else does not open it,
// short enough not to feel stuck.
const SPRING_OPEN_MS = 600

// Auto-scroll while dragging near a pane edge, so a drop target below the fold
// is reachable without letting go.
const SCROLL_ZONE_PX = 48
const SCROLL_STEP_PX = 12

/**
 * How far to scroll per tick for a drag at `clientY` over a list box, or 0 when
 * the pointer is away from both edges.
 *
 * Exported and pure so the edge logic can be tested without jsdom layout, which
 * reports every element as a zero-sized rect at the origin and makes the
 * behaviour impossible to observe through the DOM.
 */
export function edgeScrollStep(box, clientY, zone = SCROLL_ZONE_PX, step = SCROLL_STEP_PX) {
  if (clientY - box.top < zone) return -step
  if (box.bottom - clientY < zone) return step
  return 0
}

/**
 * One pane: a breadcrumb over an expandable, virtualised folder tree that is
 * also a drop target.
 *
 * Folders expand in place rather than replacing the listing, because
 * reorganising means seeing a file and its destination at the same time — and
 * navigating into the destination to "go get" the file is precisely what makes
 * that impossible. Dragging is the primary verb: rows are draggable, folders
 * spring open when a drag hovers them, and the pane auto-scrolls near its edges,
 * so a file can reach anywhere in the tree in one gesture.
 *
 * Only the rows in view are mounted. A real library can put six figures of files
 * in this tree, and rendering them all — each with drag handlers — would stall
 * the main thread on every expand.
 */
export default function FilePane({
  pane,
  side,
  onDropPaths,
  onDropFiles,
  onOpenContext,
  onClose,
  onNewFolder,
  onPreview,
  onRename,
  onDelete,
  onOpenMetadata,
  onShowShortcuts,
  compact = false,
  fill = false,
}) {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(null) // entry path being hovered, or '__pane__'
  const [dragging, setDragging] = useState(false)
  const [focused, setFocused] = useState(false)
  const springTimer = useRef(null)
  const scrollTimer = useRef(null)

  const rows = pane.rows
  const { scrollRef, onScroll, first, last, padTop, padBottom } = useVirtualRows({
    count: rows.length,
    rowHeight: ROW_HEIGHT,
  })

  const segments = pane.path ? pane.path.split('/') : []

  // Any drag ending anywhere clears this pane's affordances: a drop handled by
  // the *other* pane never fires this one's onDrop, and the highlight would
  // otherwise stick until the next hover.
  useEffect(() => {
    const end = () => {
      setDragging(false)
      setDragOver(null)
      clearTimeout(springTimer.current)
      clearInterval(scrollTimer.current)
    }
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
      clearTimeout(springTimer.current)
      clearInterval(scrollTimer.current)
    }
  }, [])

  // Two kinds of drag land here: an internal move (our own MIME type) and files
  // dragged in from the desktop ("Files" in `types`). They mean different things
  // — reorganise versus upload — so they are distinguished up front rather than
  // guessed at on drop.
  const isFileDrag = (e) => e.dataTransfer.types.includes('Files')

  const readDrag = (e) => {
    try {
      return JSON.parse(e.dataTransfer.getData(DRAG_MIME))
    } catch {
      return null
    }
  }

  const finishDrop = useCallback(
    (e, destination) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(null)
      setDragging(false)
      clearTimeout(springTimer.current)

      // Files from the desktop are an upload, not a move.
      if (isFileDrag(e) && e.dataTransfer.files?.length) {
        onDropFiles?.(e.dataTransfer.files, destination)
        return
      }
      const payload = readDrag(e)
      if (payload?.paths?.length) onDropPaths(payload.paths, destination)
    },
    [onDropPaths, onDropFiles]
  )

  const allowDrop = useCallback((e, key) => {
    const internal = e.dataTransfer.types.includes(DRAG_MIME)
    const external = e.dataTransfer.types.includes('Files')
    if (!internal && !external) return
    e.preventDefault()
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy'
    setDragOver((cur) => (cur === key ? cur : key))
  }, [])

  // --- Row callbacks. Stable identities, so memoised rows don't re-render on
  // every scroll frame.

  const handleDragStart = useCallback(
    (e, entry) => {
      // Dragging an unselected row drags just that row; dragging a selected one
      // drags the whole selection, which is what makes bulk moves feel direct.
      const paths = pane.selected.has(entry.path) ? [...pane.selected] : [entry.path]
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ paths, from: pane.path }))
      e.dataTransfer.effectAllowed = 'move'
      setDragging(true)
    },
    [pane.selected, pane.path]
  )

  const handleDragOverRow = useCallback(
    (e, entry, isOpen) => {
      if (!entry.is_dir) return
      e.stopPropagation()
      allowDrop(e, entry.path)
      // Spring-loaded folders: hovering a collapsed one during a drag opens it.
      clearTimeout(springTimer.current)
      if (!isOpen) {
        springTimer.current = setTimeout(() => pane.expand(entry.path), SPRING_OPEN_MS)
      }
    },
    [allowDrop, pane]
  )

  const handleDragLeaveRow = useCallback((entry) => {
    if (entry.is_dir) clearTimeout(springTimer.current)
  }, [])

  const handleDropRow = useCallback(
    (e, entry) => {
      if (entry.is_dir) finishDrop(e, entry.path)
    },
    [finishDrop]
  )

  const handleOpenFolder = useCallback((folderPath) => pane.navigate(folderPath), [pane])

  const handleSelect = useCallback(
    (e, entry) => {
      // Ctrl/Cmd-click still toggles one row in or out, but it moves the cursor
      // too, so a keyboard range can start from wherever the mouse left off.
      if (e.metaKey || e.ctrlKey) {
        pane.cursorTo(entry.path, { select: false })
        return pane.toggle(entry.path)
      }
      pane.cursorTo(entry.path, { extend: e.shiftKey })
    },
    [pane]
  )

  const handleContext = useCallback(
    (e, entry) => {
      e.preventDefault()
      if (!pane.selected.has(entry.path)) pane.cursorTo(entry.path)
      onOpenContext({ x: e.clientX, y: e.clientY, entry, side })
    },
    [pane, onOpenContext, side]
  )

  // --- Keyboard navigation.
  //
  // The handler is bound to the list rather than to `window`, which is what
  // makes two panes work: DOM focus already answers "which pane is active", so
  // there is no second copy of that answer to keep in sync with pinning,
  // closing, and the pane-adoption in `closePane`. It also keeps these keys from
  // fighting PreviewModal, which listens on `window` for Escape and the arrows —
  // while it is open, focus is inside it and this never runs.

  const cursorIndex = indexOfPath(rows, pane.cursor)

  /**
   * Scroll a row into view.
   *
   * Arithmetic rather than `scrollIntoView` because the list is virtualised: the
   * target row usually is not mounted yet, and `ROW_HEIGHT` is uniform, so its
   * position is known without measuring. Writing `scrollTop` fires a scroll
   * event, which feeds the virtual window on its own.
   */
  const scrollRowIntoView = useCallback(
    (index) => {
      const el = scrollRef.current
      if (!el || index < 0) return
      const top = index * ROW_HEIGHT
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
        el.scrollTop = top + ROW_HEIGHT - el.clientHeight
      }
    },
    [scrollRef]
  )

  // Keyed on the cursor rather than called from the handler, so a cursor moved
  // by any route — key, click, or a future external jump — scrolls to itself.
  useEffect(() => {
    if (pane.cursor == null) return
    scrollRowIntoView(indexOfPath(rows, pane.cursor))
  }, [pane.cursor, rows, scrollRowIntoView])

  /** Move the cursor to a row index, if it exists. */
  const moveTo = useCallback(
    (index, opts) => {
      if (index < 0 || index >= rows.length) return
      pane.cursorTo(rows[index].entry.path, opts)
    },
    [pane, rows]
  )

  const handleKeyDown = useCallback(
    (e) => {
      // Guards, in the order they are cheapest to check. The dialog check is
      // belt-and-braces: focus normally moves into an open modal, but a modal
      // that does not trap focus would otherwise let these keys act on the tree
      // behind it.
      if (e.defaultPrevented) return
      const el = e.target
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return
      if (document.querySelector('[role="dialog"]')) return

      const mod = e.metaKey || e.ctrlKey
      const row = cursorIndex >= 0 ? rows[cursorIndex] : null
      const entry = row?.entry
      // Arrowing with no cursor starts at the top rather than doing nothing.
      const from = cursorIndex >= 0 ? cursorIndex : -1
      const take = () => e.preventDefault()

      switch (e.key) {
        case 'ArrowDown': {
          take()
          // Cmd+Down on a folder is Finder's "open": it re-anchors the pane,
          // the same as double-clicking the row.
          if (mod && entry?.is_dir) return pane.navigate(entry.path)
          const next = nextSelectable(rows, from + 1, 1)
          return moveTo(next, { extend: e.shiftKey, select: !mod })
        }
        case 'ArrowUp': {
          take()
          // Cmd+Up is Finder's "enclosing folder" — but only from the top row,
          // where there is nothing above to move to.
          if (mod && from <= 0) return pane.parent !== null && pane.navigate(pane.parent)
          const prev = nextSelectable(rows, from - 1, -1)
          return moveTo(prev, { extend: e.shiftKey, select: !mod })
        }
        case 'ArrowRight': {
          take()
          const target = rightTarget(rows, cursorIndex)
          if (!target) return
          if (target.action === 'expand') return pane.toggleExpand(target.path)
          return moveTo(target.index, { extend: e.shiftKey })
        }
        case 'ArrowLeft': {
          take()
          const target = leftTarget(rows, cursorIndex)
          if (!target) return
          if (target.action === 'move') return moveTo(target.index, { extend: e.shiftKey })
          // Collapsing hides the cursor row, and a cursor pointing at a hidden
          // row is dropped. Moving to the parent first keeps the user's place on
          // the folder they just closed, which is where Finder leaves them.
          pane.cursorTo(target.path)
          return pane.toggleExpand(target.path)
        }
        case 'Home':
          take()
          return moveTo(nextSelectable(rows, 0, 1), { extend: e.shiftKey })
        case 'End':
          take()
          return moveTo(nextSelectable(rows, rows.length - 1, -1), { extend: e.shiftKey })
        case 'PageDown':
        case 'PageUp': {
          take()
          const el = scrollRef.current
          const page = Math.max(1, Math.floor((el?.clientHeight || 0) / ROW_HEIGHT) - 1)
          const dir = e.key === 'PageDown' ? 1 : -1
          const target = Math.min(rows.length - 1, Math.max(0, (from < 0 ? 0 : from) + page * dir))
          return moveTo(nextSelectable(rows, target, -dir), { extend: e.shiftKey })
        }
        case ' ':
          // Always swallowed, cursor or not: the default is to scroll the pane,
          // which is exactly the surprise this shortcut must not cause.
          take()
          if (entry) onPreview?.(entry)
          return
        case 'Enter':
        case 'F2':
          take()
          if (entry) onRename?.(entry)
          return
        case 'Delete':
        case 'Backspace':
          // Backspace is historically "browser back" — never let it through.
          take()
          if (entry) onDelete?.(entry)
          return
        case 'Escape':
          // Only meaningful when something is active; otherwise let it bubble to
          // whatever else may want it.
          if (!pane.selected.size && pane.cursor == null) return
          take()
          return pane.clearSelection()
        case '?':
          take()
          return onShowShortcuts?.()
        case 'a':
        case 'A':
          if (!mod) return
          // Without this the browser selects the page text, burying the row
          // highlight under it.
          take()
          return pane.selectAll()
        case 'i':
        case 'I':
          if (!mod) return
          take()
          if (entry) onOpenMetadata?.(entry)
          return
        default:
          return
      }
    },
    [
      rows,
      cursorIndex,
      pane,
      moveTo,
      scrollRef,
      onPreview,
      onRename,
      onDelete,
      onOpenMetadata,
      onShowShortcuts,
    ]
  )

  /** Auto-scroll the list when a drag nears its top or bottom edge. */
  const handleListDragOver = (e) => {
    const el = scrollRef.current
    if (!el) return
    clearInterval(scrollTimer.current)
    const step = edgeScrollStep(el.getBoundingClientRect(), e.clientY)
    if (!step) return
    scrollTimer.current = setInterval(() => {
      el.scrollTop += step
    }, 16)
  }

  const visible = rows.slice(first, last)

  return (
    <div
      style={{
        // `flex-basis: 0` (not `auto`) so two panes divide the axis evenly
        // whether they are side by side or stacked, rather than being sized by
        // their content. `minWidth`/`minHeight: 0` override the flex default of
        // `min-*: auto`, which would otherwise let a long tree push the pane
        // past its share and scroll the page instead of the list.
        flex: '1 1 0',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--bg-panel)',
        overflow: 'hidden',
        outline: dragOver === '__pane__' ? '2px solid var(--gold)' : 'none',
      }}
      onDragOver={(e) => allowDrop(e, '__pane__')}
      onDragLeave={(e) => {
        // Only clear when the pointer actually leaves the pane, not when it
        // crosses between child rows.
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null)
      }}
      onDrop={(e) => finishDrop(e, pane.path)}
      data-testid={`file-pane-${side}`}
    >
      {/* Breadcrumb */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexWrap: 'wrap',
          padding: '8px 10px',
          borderBottom: '1px solid var(--border)',
          fontSize: 13,
          minHeight: 38,
        }}
      >
        <button
          onClick={() => pane.navigate('')}
          style={crumbStyle(!pane.path)}
          title={t('files.libraryRoot')}
        >
          {t('files.libraryRoot')}
        </button>
        {segments.map((seg, i) => {
          const target = segments.slice(0, i + 1).join('/')
          return (
            <span key={target} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <LuChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
              <button
                onClick={() => pane.navigate(target)}
                style={crumbStyle(i === segments.length - 1)}
              >
                {seg}
              </button>
            </span>
          )
        })}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {!pane.writable && !pane.loading && (
            <span
              title={t('files.readOnlyHint')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--text-muted)',
              }}
            >
              <LuLock size={12} />
              {t('files.readOnly')}
            </span>
          )}
          {/* Creating a folder *here* — in the folder the pane is showing —
              needed the right-click menu and a folder to click on, which is
              impossible in an empty folder. Styled as a real button rather than
              a breadcrumb, since it acts on the library instead of navigating.
              Hidden on a read-only mount, where the API would refuse it. */}
          {onNewFolder && pane.writable && (
            <button
              onClick={() => onNewFolder(pane.path)}
              style={actionBtnStyle}
              title={t('files.newFolderHere')}
              data-testid={`new-folder-${side}`}
            >
              <LuFolderPlus size={12} /> {t('files.newFolder')}
            </button>
          )}
          {pane.parent !== null && (
            <button onClick={() => pane.navigate(pane.parent)} style={crumbStyle(false)}>
              <LuArrowUp size={12} /> {t('files.up')}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              style={crumbStyle(false)}
              title={t('files.closePane')}
              aria-label={t('files.closePane')}
              data-testid={`close-pane-${side}`}
            >
              <LuX size={13} />
            </button>
          )}
        </span>
      </div>

      {/* Tree */}
      <div
        ref={scrollRef}
        data-testid={`file-list-${side}`}
        // Focusable so the tree can be driven by keyboard at all, and so Tab
        // moves between the two panes without any code of our own.
        tabIndex={0}
        role="listbox"
        aria-label={t('files.libraryTree')}
        aria-activedescendant={pane.cursor ? rowDomId(side, pane.cursor) : undefined}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onScroll={onScroll}
        onDragOver={handleListDragOver}
        onDragLeave={() => clearInterval(scrollTimer.current)}
        style={{
          flex: 1,
          overflowY: 'auto',
          // Which pane has the keys is otherwise invisible, and with two panes
          // open that is the difference between renaming the right file and the
          // wrong one. Drawn inside the edge so it does not shift the layout.
          outline: focused ? '2px solid var(--gold)' : 'none',
          outlineOffset: -2,
          // When the pane fills a sized parent, the list takes whatever is left
          // and scrolls inside it — independently of the other pane and of the
          // page, which never scrolls. `minHeight: 0` is required for that in a
          // flex column. Standalone (unsized) use keeps an explicit height.
          minHeight: fill ? 0 : compact ? 240 : 380,
          ...(fill ? {} : { maxHeight: compact ? 360 : '60vh' }),
        }}
      >
        {pane.loading && !rows.length && (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Spinner size={18} />
          </div>
        )}

        {!pane.loading && pane.error && (
          <div
            style={{
              padding: 20,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              color: 'var(--danger)',
              fontSize: 13,
            }}
          >
            <LuTriangleAlert size={15} /> {pane.error}
          </div>
        )}

        {!pane.loading && !pane.error && rows.length === 0 && (
          <div
            style={{
              padding: 28,
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {t('files.emptyFolder')}
            {/* No inline create button: folder creation is a right-click action
                on the folder it belongs in, so there is one place to look for
                it rather than two that behave subtly differently. */}
            {pane.writable && (
              <div style={{ marginTop: 6, fontSize: 12 }}>{t('files.emptyFolderHint')}</div>
            )}
          </div>
        )}

        {/* Spacers stand in for the rows outside the window so the scrollbar
            reflects the full tree. */}
        {padTop > 0 && <div style={{ height: padTop }} />}

        {visible.map((row) => {
          // Placeholder rows report the state of an expanded subfolder that has
          // nothing to list yet.
          if (row.placeholder) {
            return (
              <div
                key={`${row.placeholder}-${row.path}`}
                style={{
                  height: ROW_HEIGHT,
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 10px',
                  paddingLeft: 10 + row.depth * 16 + 18,
                  fontSize: 12,
                  color: row.placeholder === 'error' ? 'var(--danger)' : 'var(--text-muted)',
                }}
              >
                {row.placeholder === 'loading' && <Spinner size={11} />}
                {row.placeholder === 'loading' && t('common.loading')}
                {row.placeholder === 'empty' && t('files.emptyFolder')}
                {row.placeholder === 'error' && row.text}
                {row.placeholder === 'truncated' && (
                  <span>{t('files.truncated', { shown: row.shown, total: row.total })}</span>
                )}
              </div>
            )
          }

          return (
            <FileRow
              key={row.entry.path}
              id={rowDomId(side, row.entry.path)}
              entry={row.entry}
              depth={row.depth}
              isOpen={row.isOpen}
              isSelected={pane.selected.has(row.entry.path)}
              isCursor={pane.cursor === row.entry.path}
              isDropTarget={dragOver === row.entry.path}
              height={ROW_HEIGHT}
              onToggleExpand={pane.toggleExpand}
              onOpenFolder={handleOpenFolder}
              onSelect={handleSelect}
              onContext={handleContext}
              onDragStart={handleDragStart}
              onDragOverRow={handleDragOverRow}
              onDragLeaveRow={handleDragLeaveRow}
              onDropRow={handleDropRow}
            />
          )
        })}

        {padBottom > 0 && <div style={{ height: padBottom }} />}

        {/* A drop zone for the pane's own folder, so items can be moved *out* of
            a subfolder without collapsing the tree to reach the root row. */}
        {dragging && rows.length > 0 && (
          <div
            onDragOver={(e) => allowDrop(e, '__pane__')}
            onDrop={(e) => finishDrop(e, pane.path)}
            style={{
              margin: 8,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px dashed var(--border)',
              color: 'var(--text-muted)',
              fontSize: 12,
              textAlign: 'center',
              background: dragOver === '__pane__' ? 'var(--bg-card-hover)' : 'transparent',
            }}
          >
            {t('files.dropHere', { path: pane.path || t('files.libraryRoot') })}
          </div>
        )}
      </div>
    </div>
  )
}

// `aria-activedescendant` needs a real element id, and a path is not one — it
// carries slashes, spaces and whatever else a filename holds. Scoped by side so
// the two panes never mint the same id for the same file.
function rowDomId(side, path) {
  return `filerow-${side}-${encodeURIComponent(path)}`
}

// Unlike the breadcrumbs beside it, this one *does* something to the library
// rather than moving around it — so it carries a border and a filled background
// instead of reading as another piece of the path.
const actionBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 9px',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
}

function crumbStyle(active) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'none',
    border: 'none',
    padding: '2px 4px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    color: active ? 'var(--text)' : 'var(--text-dim)',
    fontWeight: active ? 600 : 400,
  }
}
