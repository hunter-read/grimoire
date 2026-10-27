import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { files as filesApi } from '../../api'
import Spinner from '../Spinner'
import FolderTree from './FolderTree'

/**
 * Pick a destination folder for a move.
 *
 * The file manager moves things by dragging one pane onto another, which needs
 * both ends on screen — a luxury a book's own page does not have. This is the
 * same tree with the file half removed (see FolderTree): only folders are
 * listed, because the only question being asked is *where*, and showing files
 * would offer targets that cannot be dropped on.
 */
export default function MoveModal({ items, onClose, onMoved }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Escape closes, unless a move is already in flight. A window listener rather
  // than a handler on the panel: nothing here is autofocused, so focus may still
  // be on the pane that opened the dialog.
  useEffect(() => {
    if (busy) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // The paths being moved, and their parents. A folder cannot be moved inside
  // itself, and moving something into the folder it already sits in is a no-op —
  // both are refused by the API, so the picker never offers them.
  const sources = items.map((i) => i.path)
  const parents = new Set(sources.map((p) => p.split('/').slice(0, -1).join('/')))
  const isBlocked = (path) =>
    parents.has(path) || sources.some((s) => path === s || path.startsWith(`${s}/`))

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

        <FolderTree
          testId="move-tree"
          selected={selected}
          onSelect={setSelected}
          isBlocked={isBlocked}
          blockedLabel={t('files.moveBlocked')}
        />

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
