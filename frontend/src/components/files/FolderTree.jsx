import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFolderOpen } from 'react-icons/lu'
import { files as filesApi } from '../../api'
import Spinner from '../Spinner'
import MoveFolderRow, { moveRowStyle } from './MoveFolderRow'

/** Every ancestor of a folder path, root first: "a/b/c" -> ["", "a", "a/b"]. */
const ancestorsOf = (path) => {
  const parts = path ? path.split('/') : []
  return ['', ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))]
}

/**
 * A lazily loaded tree of library folders to pick a destination from.
 *
 * Only folders are listed, because the only question being asked is *where*.
 * Folders expand in place and load one request per folder on first open, so
 * showing the tree costs a single listing of the root rather than a walk of the
 * library. Unwritable folders stay visible but unselectable: hiding them would
 * make a read-only mount look like a missing folder.
 *
 * `revealPath` opens the tree down to that folder (and its ancestors) on mount,
 * so a picker that suggests a destination shows it rather than a closed root.
 * `isBlocked(path)` refuses further folders - a move cannot go inside itself.
 * `onLoaded(path, folder)` reports each listing, for callers that want to know
 * what the library holds (which collections exist at the root).
 *
 * Shared by the move dialog and the save-to-library dialog.
 */
export default function FolderTree({
  selected,
  onSelect,
  isBlocked = () => false,
  blockedLabel,
  revealPath = '',
  onLoaded,
  testId,
}) {
  const { t } = useTranslation()
  // path -> { entries, writable, loading }
  const [folders, setFolders] = useState({})
  const [expanded, setExpanded] = useState(
    () => new Set(ancestorsOf(revealPath).concat(revealPath ? [revealPath] : []))
  )

  const load = useCallback(
    async (target) => {
      setFolders((prev) =>
        prev[target]?.entries ? prev : { ...prev, [target]: { loading: true, entries: [] } }
      )
      let folder
      try {
        const res = await filesApi.browse(target)
        // Folders only: a file is never a destination.
        folder = {
          entries: (res.entries || []).filter((e) => e.is_dir),
          writable: res.writable,
          loading: false,
        }
      } catch {
        folder = { entries: [], writable: false, loading: false }
      }
      setFolders((prev) => ({ ...prev, [target]: folder }))
      onLoaded?.(target, folder)
    },
    [onLoaded]
  )

  useEffect(() => {
    expanded.forEach((path) => load(path))
    // Mount only: later expansions load from `toggle`.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (path) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
        if (!folders[path]) load(path)
      }
      return next
    })
  }

  const rows = []
  const walk = (path, depth) => {
    const folder = folders[path]
    if (!folder) return
    if (folder.loading && !folder.entries.length) {
      rows.push({ kind: 'loading', path, depth })
      return
    }
    for (const entry of folder.entries) {
      rows.push({ kind: 'folder', entry, depth })
      if (expanded.has(entry.path)) walk(entry.path, depth + 1)
    }
  }
  walk('', 0)

  const rootWritable = folders['']?.writable !== false

  return (
    <div style={treeBox} data-testid={testId}>
      <button
        type="button"
        onClick={() => rootWritable && onSelect('')}
        disabled={!rootWritable}
        aria-pressed={selected === ''}
        style={moveRowStyle(0, selected === '', !rootWritable)}
      >
        <span style={{ width: 13 }} />
        <LuFolderOpen size={13} aria-hidden="true" />
        {t('files.libraryRoot')}
      </button>

      {rows.map((row) =>
        row.kind === 'loading' ? (
          <div
            key={`loading-${row.path}`}
            style={{ ...moveRowStyle(row.depth + 1, false, true), cursor: 'default' }}
          >
            <Spinner size={12} />
          </div>
        ) : (
          <MoveFolderRow
            key={row.entry.path}
            entry={row.entry}
            depth={row.depth + 1}
            open={expanded.has(row.entry.path)}
            selected={selected === row.entry.path}
            blocked={isBlocked(row.entry.path)}
            onToggle={() => toggle(row.entry.path)}
            onSelect={() => onSelect(row.entry.path)}
            blockedLabel={blockedLabel}
            expandLabel={t('files.expandFolder', { name: row.entry.name })}
          />
        )
      )}
    </div>
  )
}

const treeBox = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-card)',
  padding: 4,
  maxHeight: 320,
  overflowY: 'auto',
}
