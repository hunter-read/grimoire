import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTriangleAlert } from 'react-icons/lu'
import { files as filesApi } from '../../api'
import Spinner from '../Spinner'

/**
 * Confirm deleting a file or folder from the library.
 *
 * The guard scales with the blast radius rather than being uniform, because a
 * uniform guard trains people to click through it. A file, and a folder holding
 * nothing but empty shells, get a plain confirm. A folder that still holds
 * content demands its own name typed in — the one case where a mis-click costs
 * a collection rather than one file.
 *
 * Whether a folder counts as empty is asked of the server, not counted from the
 * listing on screen: the listing hides sidecars and marker files, so a client
 * that counted rows would call a folder empty that the delete then refuses.
 * While that request is in flight the confirm button stays disabled, so the
 * dialog can never be submitted before it knows which guard applies.
 */
export default function DeleteModal({ entry, onClose, onDeleted }) {
  const { t } = useTranslation()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // null while unknown — a folder's contents are checked before the dialog can
  // be submitted. Files are known up front: they never need the typed guard.
  const [hasContent, setHasContent] = useState(entry.is_dir ? null : false)

  useEffect(() => {
    if (!entry.is_dir) return
    let cancelled = false
    filesApi
      .folderContents(entry.path)
      .then((res) => {
        if (!cancelled) setHasContent(res.has_content)
      })
      .catch(() => {
        // Unknown means assume the worst: ask for the typed name rather than
        // offering a one-click delete of a folder we could not inspect.
        if (!cancelled) setHasContent(true)
      })
    return () => {
      cancelled = true
    }
  }, [entry.is_dir, entry.path])

  const needsName = hasContent === true
  const checking = hasContent === null
  const confirmed = !needsName || typed.trim() === entry.name

  const submit = async (e) => {
    e.preventDefault()
    if (busy || checking || !confirmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await filesApi.deleteEntry(entry.path, needsName ? typed.trim() : null)
      onDeleted?.(res, entry)
      onClose()
    } catch (err) {
      setError(err.message || t('files.deleteFailed'))
      setBusy(false)
    }
  }

  return (
    <div style={backdrop} onClick={onClose}>
      <form
        style={panel}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={t('files.deleteTitle')}
      >
        <h3
          style={{
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--danger)',
          }}
        >
          <LuTriangleAlert size={17} aria-hidden="true" />
          {t('files.deleteTitle')}
        </h3>

        <p style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.5, wordBreak: 'break-word' }}>
          {entry.is_dir
            ? t('files.deleteFolderPrompt', { name: entry.name })
            : t('files.deleteFilePrompt', { name: entry.name })}
        </p>

        <p style={warning}>
          {entry.is_dir && needsName
            ? t('files.deleteFolderWarning')
            : t('files.deleteIrreversible')}
        </p>

        {needsName && (
          <div style={{ marginTop: 14 }}>
            <label
              htmlFor="delete-confirm-name"
              style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', marginBottom: 6 }}
            >
              {t('files.deleteTypeName')}
            </label>
            {/* The name is shown selectable rather than only described, so it
                can be copied and pasted. The guard exists to force a deliberate
                look at *which* folder is going, not to test typing accuracy. */}
            <code style={nameChip} data-testid="delete-confirm-target">
              {entry.name}
            </code>
            <input
              id="delete-confirm-name"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={entry.name}
              autoComplete="off"
              spellCheck="false"
              style={input}
            />
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }} role="alert">
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btn()}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={busy || checking || !confirmed} style={btn(true)}>
            {busy ? <Spinner size={13} /> : null}
            {t('files.deletePermanently')}
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
  zIndex: 1100,
  padding: 16,
}

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 20,
  width: 'min(440px, 100%)',
}

const warning = {
  fontSize: 12,
  color: 'var(--text-dim)',
  lineHeight: 1.5,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
}

const nameChip = {
  display: 'block',
  userSelect: 'all',
  fontSize: 12,
  padding: '6px 8px',
  borderRadius: 5,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  marginBottom: 8,
  wordBreak: 'break-all',
}

const input = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-input)',
  color: 'var(--text)',
  fontSize: 13,
}

function btn(danger) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: danger ? 'var(--danger)' : 'transparent',
    color: danger ? 'var(--on-accent)' : 'var(--text-dim)',
  }
}
