import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Spinner from '../Spinner'
import { splitExtension, joinExtension } from './filename'

/**
 * Rename a file or folder on disk.
 *
 * Deliberately distinct from the display-name edit on an item's page: that
 * changes only the DB title, while this changes the bytes' actual name. The
 * copy says so, because the two are easy to confuse and only one of them is
 * visible to anything outside Grimoire.
 */
export default function RenameModal({ entry, onClose, onRename }) {
  const { t } = useTranslation()
  // The extension is held aside and re-attached on save. Letting it be edited
  // here would let a rename change the file's type — Grimoire infers MIME type,
  // thumbnailing, and whether a file is indexable at all from the suffix, so a
  // typo'd ".pdf" silently drops the book out of the library.
  const { stem, ext } = splitExtension(entry.name, entry.is_dir)
  const [value, setValue] = useState(stem)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const nextName = joinExtension(value, ext)
  const unchanged = nextName === entry.name

  const submit = async (e) => {
    e.preventDefault()
    if (!value.trim() || unchanged || busy) return
    setBusy(true)
    setError(null)
    try {
      await onRename(entry.path, nextName)
      onClose()
    } catch (err) {
      setError(err.message || t('files.renameFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Escape closes. Handled on the panel rather than on `window` because the name
  // field is autofocused, so focus is already inside — and a window listener
  // would also fire for a pane keystroke that happened to bubble while this was
  // open. `stopPropagation` keeps it from reaching the file pane behind it,
  // which reads Escape as "clear the selection".
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }

  return (
    <div style={backdrop} onClick={onClose}>
      <form
        style={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('files.rename')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        onSubmit={submit}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{t('files.rename')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.5 }}>
          {t('files.renameHint')}
        </p>
        <div style={{ display: 'flex', alignItems: 'stretch', marginBottom: 12 }}>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{
              ...input,
              marginBottom: 0,
              ...(ext ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : null),
            }}
            aria-label={t('files.newName')}
          />
          {ext && (
            <span
              // Shown, not editable: the user sees exactly what the file will be
              // called without being able to break its type.
              data-testid="rename-extension"
              title={t('files.extensionFixed')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 10px',
                border: '1px solid var(--border)',
                borderLeft: 'none',
                borderTopRightRadius: 6,
                borderBottomRightRadius: 6,
                background: 'var(--bg-card)',
                color: 'var(--text-muted)',
                fontSize: 13,
                whiteSpace: 'nowrap',
              }}
            >
              {ext}
            </span>
          )}
        </div>
        {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btn()}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy || !value.trim() || unchanged} style={btn(true)}>
            {busy ? <Spinner size={13} /> : null}
            {t('files.rename')}
          </button>
        </div>
      </form>
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
  zIndex: 1000,
  padding: 16,
}

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
  width: 'min(420px, 100%)',
}

const input = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-input)',
  color: 'var(--text)',
  fontSize: 13,
  marginBottom: 12,
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
