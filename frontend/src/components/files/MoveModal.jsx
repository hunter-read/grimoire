import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFolderOpen } from 'react-icons/lu'
import { files as filesApi } from '../../api'
import Spinner from '../Spinner'
import MoveFolderRow, { moveRowStyle } from './MoveFolderRow'

/**
 * Pick a destination folder for a move.
 *
 * The file manager moves things by dragging one pane onto another, which needs
 * both ends on screen — a luxury a book's own page does not have. This is the
 * same tree with the file half removed: only folders are listed, because the
 * only question being asked is *where*, and showing files would offer targets
 * that cannot be dropped on.
 *
 * Folders expand in place and load lazily, one request per folder on first open,
 * so opening the dialog costs a single listing of the root rather than a walk of
 * the library. Unwritable folders stay visible but unselectable: hiding them
 * would make a read-only mount look like a missing folder.
 */
export default function MoveModal({ items, onClose, onMoved }) {
  const { t } = useTranslation()
  // path -> { entries, writable, loading }
  const [folders, setFolders] = useState({})
  const [expanded, setExpanded] = useState(() => new Set(['']))
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (target) => {
    setFolders((prev) =>
      prev[target]?.entries ? prev : { ...prev, [target]: { loading: true, entries: [] } }
    )
    try {
      const res = await filesApi.browse(target)
      setFolders((prev) => ({
        ...prev,
        [target]: {
          // Folders only: a file is never a destination.
          entries: (res.entries || []).filter((e) => e.is_dir),
          writable: res.writable,
          loading: false,
        },
      }))
    } catch {
      setFolders((prev) => ({
        ...prev,
        [target]: { entries: [], writable: false, loading: false },
      }))
    }
  }, [])

  useEffect(() => {
    load('')
  }, [load])

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

  // The paths being moved, and their parents. A folder cannot be moved inside
  // itself, and moving something into the folder it already sits in is a no-op —
  // both are refused by the API, so the picker never offers them.
  const sources = items.map((i) => i.path)
  const parents = new Set(sources.map((p) => p.split('/').slice(0, -1).join('/')))
  const isBlocked = (path) =>
    parents.has(path) || sources.some((s) => path === s || path.startsWith(`${s}/`))

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

  const submit = async () => {
    if (selected === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await filesApi.move(sources, selected, 'rename')
      if (!res.count) {
        setError(res.skipped?.[0]?.reason || t('files.nothingMoved'))
        setBusy(false)
        return
      }
      onMoved?.(res, selected)
      onClose()
    } catch (e) {
      setError(e.message || t('files.moveFailed'))
      setBusy(false)
    }
  }

  const rootWritable = folders['']?.writable !== false

  return (
    <div style={backdrop} onClick={onClose}>
      <div
        style={panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('files.moveTitle')}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{t('files.moveTitle')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.5 }}>
          {items.length === 1
            ? t('files.movePrompt', { name: items[0].name })
            : t('files.movePromptMany', { count: items.length })}
        </p>

        <div style={treeBox} data-testid="move-tree">
          <button
            type="button"
            onClick={() => rootWritable && setSelected('')}
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
                onSelect={() => setSelected(row.entry.path)}
                blockedLabel={t('files.moveBlocked')}
                expandLabel={t('files.expandFolder', { name: row.entry.name })}
              />
            )
          )}
        </div>

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }} role="alert">
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onClose} style={btn()}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={selected === null || busy}
            style={btn(true)}
          >
            {busy ? <Spinner size={13} /> : null}
            {t('files.moveHere')}
          </button>
        </div>
      </div>
    </div>
  )
}

const backdrop = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1100,
  padding: 16,
}

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
  width: 'min(480px, 100%)',
}

const treeBox = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-card)',
  padding: 4,
  maxHeight: 320,
  overflowY: 'auto',
}

function btn(primary) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: primary ? 'var(--gold)' : 'transparent',
    color: primary ? 'var(--on-accent)' : 'var(--text-dim)',
  }
}
