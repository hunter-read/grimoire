import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Spinner from '../Spinner'

// Container kinds as the backend names them. Marking a folder here writes the
// corresponding marker file (`.parent-system-container`, …), which is the whole
// point: the convention is otherwise something the user has to recall from the
// docs and create by hand in another tool.
const KINDS = ['', 'parent', 'one-page', 'family', 'publisher', 'generic']

/**
 * Create a folder, optionally declaring it a container and/or NSFW.
 */
export default function NewFolderModal({ parent, onClose, onCreate }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('')
  const [nsfw, setNsfw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(name.trim(), { containerKind: kind, nsfw })
      onClose()
    } catch (err) {
      setError(err.message || t('files.createFailed'))
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
        aria-label={t('files.newFolder')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        onSubmit={submit}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{t('files.newFolder')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 14 }}>
          {t('files.inFolder', { path: parent || t('files.libraryRoot') })}
        </p>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('files.folderName')}
          style={input}
          aria-label={t('files.folderName')}
        />

        <label style={label} htmlFor="container-kind">
          {t('files.containerKind')}
        </label>
        <select
          id="container-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          style={input}
        >
          {KINDS.map((k) => (
            <option key={k || 'none'} value={k}>
              {k ? t(`files.kind.${k}`) : t('files.kind.none')}
            </option>
          ))}
        </select>
        <p
          style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}
        >
          {t('files.containerHint')}
        </p>

        <label
          style={{ ...label, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        >
          <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
          {t('files.markNsfw')}
        </label>

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btn()}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!name.trim() || busy} style={btn(true)}>
            {busy ? <Spinner size={13} /> : null}
            {t('files.create')}
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

const label = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-dim)',
  marginBottom: 6,
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
