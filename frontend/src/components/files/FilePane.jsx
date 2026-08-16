import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronRight, LuArrowUp, LuTriangleAlert, LuLock, LuX } from 'react-icons/lu'
import Spinner from '../Spinner'
import FileRow from './FileRow'
import useVirtualRows from '../../hooks/useVirtualRows'

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
  compact = false,
  fill = false,
}) {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(null) // entry path being hovered, or '__pane__'
  const [dragging, setDragging] = useState(false)
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
      if (e.metaKey || e.ctrlKey) pane.toggle(entry.path)
      else pane.selectOnly(entry.path)
    },
    [pane]
  )

  const handleContext = useCallback(
    (e, entry) => {
      e.preventDefault()
      if (!pane.selected.has(entry.path)) pane.selectOnly(entry.path)
      onOpenContext({ x: e.clientX, y: e.clientY, entry, side })
    },
    [pane, onOpenContext, side]
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
        onScroll={onScroll}
        onDragOver={handleListDragOver}
        onDragLeave={() => clearInterval(scrollTimer.current)}
        style={{
          flex: 1,
          overflowY: 'auto',
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
              entry={row.entry}
              depth={row.depth}
              isOpen={row.isOpen}
              isSelected={pane.selected.has(row.entry.path)}
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
