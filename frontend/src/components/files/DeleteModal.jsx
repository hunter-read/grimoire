import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTriangleAlert } from 'react-icons/lu'
import { files as filesApi } from '../../api'
import Spinner from '../Spinner'

/**
 * Confirm removing a file or folder from the library, from the index or disk.
 *
 * Two operations in one dialog, because they answer the same question ("how far
 * should this go away?"), and splitting them into two menu entries would make
 * the user pick before seeing what either one costs.
 *
 * The default is the **soft** remove: the record goes, the file stays, and a
 * rescan brings it back unless it is now excluded or gone from disk. That is the
 * safe, common case (tidying up after a `.grimoireignore`, or clearing a row
 * whose file was deleted outside Grimoire), so it is what the dialog opens on
 * and its button is styled as ordinary, not alarming.
 *
 * Ticking "also delete the files" turns it into the irreversible one, and the
 * dialog changes with it: the title, the explanation, and the button all switch
 * to the destructive wording, and the button turns red. The appearance tracks
 * the consequence rather than staying constant, so the red button always means
 * the same thing and never gets clicked through out of habit.
 *
 * The guard scales with the blast radius rather than being uniform, because a
 * uniform guard trains people to click through it. A file, and a folder holding
 * nothing but empty shells, get a plain confirm. A folder that still holds
 * content demands its own name typed in, but only when files are actually being
 * destroyed. A soft remove is undone by a rescan, so making someone type a
 * folder name to reach it would spend the guard where nothing is at stake and
 * cheapen it where something is.
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
  // Off by default: the destructive half is always opted into. Nothing about
  // opening this dialog should be able to erase a file on its own.
  const [deleteFiles, setDeleteFiles] = useState(false)
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

  // The typed-name guard belongs to file destruction, not to the dialog. A soft
  // remove of a full folder is reversed by a rescan, so it gets a plain confirm.
  const needsName = hasContent === true && deleteFiles
  const checking = hasContent === null
  const confirmed = !needsName || typed.trim() === entry.name

  const submit = async (e) => {
    e.preventDefault()
    if (busy || checking || !confirmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await filesApi.deleteEntry(
        entry.path,
        needsName ? typed.trim() : null,
        deleteFiles
      )
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
        aria-label={deleteFiles ? t('files.deleteTitle') : t('files.removeTitle')}
      >
        <h3
          style={{
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            // The alarm is spent on the destructive mode only. A heading that is
            // always red would say nothing about which of the two is selected.
            color: deleteFiles ? 'var(--danger)' : 'var(--text)',
          }}
        >
          {deleteFiles ? <LuTriangleAlert size={17} aria-hidden="true" /> : null}
          {deleteFiles ? t('files.deleteTitle') : t('files.removeTitle')}
        </h3>

        <p style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.5, wordBreak: 'break-word' }}>
          {promptText(t, entry, deleteFiles)}
        </p>

        <p style={warning} data-testid="delete-explain">
          {explainText(t, entry, deleteFiles, needsName)}
        </p>

        {/* The mode switch. Unchecked is a reversible remove; checked erases the
            file. Kept below the explanation so the text above it has already
            said what each one does by the time it is read. */}
        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={deleteFiles}
            onChange={(e) => setDeleteFiles(e.target.checked)}
            data-testid="delete-files-toggle"
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>
              {t('files.deleteFilesCheckbox')}
            </span>
            <span
              style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}
            >
              {t('files.deleteFilesCheckboxHint')}
            </span>
          </span>
        </label>

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
          <button type="button" onClick={onClose} style={btn('cancel')}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || checking || !confirmed}
            style={btn(deleteFiles ? 'danger' : 'warning')}
            data-testid="delete-submit"
          >
            {busy ? <Spinner size={13} /> : null}
            {deleteFiles ? t('files.deletePermanently') : t('files.removeFromLibrary')}
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

/**
 * The consequence text under the prompt.
 *
 * Given a fixed minimum height because its four variants differ in length by
 * more than a line, and ticking the checkbox swaps between them: without this
 * the panel jumps and the checkbox slides out from under the cursor mid-click.
 * `min-height` rather than a fixed one, so a long folder name that wraps grows
 * the block instead of overflowing it.
 */
const warning = {
  fontSize: 12,
  color: 'var(--text-dim)',
  lineHeight: 1.5,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  // Sized to the longest of the four variants (the folder soft-remove text, ~5
  // wrapped lines in the 440px panel) so toggling never shrinks the block.
  minHeight: 110,
  boxSizing: 'border-box',
}

const checkboxRow = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  marginTop: 12,
  cursor: 'pointer',
  lineHeight: 1.45,
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

/**
 * The dialog's buttons, in three weights.
 *
 * `cancel` is the quiet one. The confirm button is deliberately *not* quiet even
 * in the reversible mode: it still detaches tags, bookmarks and campaign links,
 * so it should not look like the same non-action as Cancel sitting beside it.
 * It gets the warning amber, which reads as "this does something" without the
 * alarm the red is reserved for.
 *
 * `danger` fills solid, since that variant erases files and is the one case
 * where the button should stop the eye.
 */
function btn(variant) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-dim)',
  }
  if (variant === 'danger') {
    return {
      ...base,
      border: '1px solid var(--danger)',
      background: 'var(--danger)',
      color: 'var(--on-accent)',
    }
  }
  if (variant === 'warning') {
    // Tinted rather than filled: --warning is a mid amber that shifts lightness
    // between themes, so a solid fill would need a different text colour in each
    // one. An outline with amber text keeps the contrast right in both.
    return {
      ...base,
      border: '1px solid var(--warning, #d98324)',
      color: 'var(--warning, #d98324)',
      fontWeight: 600,
    }
  }
  return base
}

/** Which "delete this?" question to ask, given the mode and what was clicked. */
function promptText(t, entry, deleteFiles) {
  if (deleteFiles) {
    return entry.is_dir
      ? t('files.deleteFolderPrompt', { name: entry.name })
      : t('files.deleteFilePrompt', { name: entry.name })
  }
  return entry.is_dir
    ? t('files.deleteFolderPromptSoft', { name: entry.name })
    : t('files.deleteFilePromptSoft', { name: entry.name })
}

/**
 * The consequence text under the prompt.
 *
 * Four cases, because the two axes are independent: a soft remove has to explain
 * that a rescan undoes it (and phrase that for one file or a folder of them),
 * while a permanent delete has to say what is being erased, with the stronger
 * wording reserved for a folder that still holds content, which is the only
 * variant that also demands the typed name.
 */
function explainText(t, entry, deleteFiles, needsName) {
  if (!deleteFiles) {
    return entry.is_dir ? t('files.deleteFolderSoftExplain') : t('files.deleteSoftExplain')
  }
  return needsName ? t('files.deleteFolderWarning') : t('files.deleteIrreversible')
}
