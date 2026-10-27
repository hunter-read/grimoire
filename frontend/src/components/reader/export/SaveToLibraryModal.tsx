import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuX } from 'react-icons/lu'
import api from '../../../api'
import useDialogFocus from '../../../hooks/useDialogFocus'
import { SCAN_STARTED } from '../../../hooks/useScanStatus'
import FolderTree from '../../files/FolderTree'
import Spinner from '../../Spinner'
import {
  buttonStyle,
  chipStyle,
  errorStyle,
  hintStyle,
  labelStyle,
  warnStyle,
} from './exportStyles'

const parentOf = (path) => (path ? path.split('/').slice(0, -1).join('/') : '')
const collectionOf = (path) => (path || '').split('/')[0].toLowerCase()

/**
 * Save an export into the library instead of downloading it (admins, writable
 * library only - the caller decides whether to offer it).
 *
 * Opens on the folder the source file lives in, with one-tap jumps to the
 * Tokens and Maps collections when the library has them, since a token sheet's
 * cut-outs belong with the tokens and a book's map with the maps.
 *
 * A PDF headed for Tokens is flagged before saving rather than after: Tokens
 * only index images, and the server would refuse it anyway.
 *
 * Saved files are not in the library until a scan picks them up, so a scan of
 * just the destination folder is started straight away - or, if one is already
 * running, the user is told they will appear after it.
 */
export default function SaveToLibraryModal({
  basePath,
  body,
  sourcePath,
  title,
  summary,
  onClose,
}) {
  const { t } = useTranslation()
  const dialogRef = useRef(null)
  const beside = parentOf(sourcePath || '')
  const [selected, setSelected] = useState(beside || null)
  const [roots, setRoots] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useDialogFocus(dialogRef, { onClose: busy ? undefined : onClose })

  const onLoaded = useCallback((path, folder) => {
    if (path === '') setRoots(folder.entries)
  }, [])

  const rootNamed = (name) => roots.find((e) => e.name.toLowerCase() === name)
  const quick = [
    beside ? { key: 'beside', label: t('pageExport.quickBeside'), path: beside } : null,
    rootNamed('tokens')
      ? { key: 'tokens', label: t('nav.tokens'), path: rootNamed('tokens').path }
      : null,
    rootNamed('maps') ? { key: 'maps', label: t('nav.maps'), path: rootNamed('maps').path } : null,
  ].filter(Boolean)

  const pdfIntoTokens = body.format === 'pdf' && collectionOf(selected) === 'tokens'
  const canSave = selected !== null && selected !== '' && !pdfIntoTokens && !busy

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.post(`${basePath}/export/save`, { ...body, destination: selected })
      let indexing = 'later'
      try {
        const scan = await api.post('/rescan', { scope: res.folder, metadata_mode: 'new' })
        if (scan?.status === 'scan_started') {
          indexing = 'started'
          window.dispatchEvent(new Event(SCAN_STARTED))
        }
      } catch {
        // The files are saved; only the follow-up scan failed. Say so softly.
      }
      setResult({ ...res, indexing })
    } catch (e) {
      setError(e.message || t('pageExport.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={backdrop} onClick={() => !busy && onClose()} data-testid="save-to-library">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-export-title"
        onClick={(e) => e.stopPropagation()}
        style={panel}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 id="save-export-title" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            {result ? t('pageExport.savedTitle') : t('pageExport.saveTitle')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('common.close')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              padding: 2,
            }}
          >
            <LuX size={16} />
          </button>
        </div>

        {result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <LuCircleCheck
                size={20}
                color="var(--success)"
                style={{ flexShrink: 0, marginTop: 1 }}
                aria-hidden="true"
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 14, color: 'var(--text)' }}>
                  {t('pageExport.savedBody', { count: result.saved.length, folder: result.folder })}
                </span>
                <span style={hintStyle}>
                  {result.indexing === 'started'
                    ? t('pageExport.indexing', { count: result.saved.length })
                    : t('pageExport.indexLater')}
                </span>
              </div>
            </div>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: '6px 10px',
                maxHeight: 160,
                overflowY: 'auto',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-dim)',
              }}
            >
              {result.saved.map((f) => (
                <li key={f.path} style={{ padding: '3px 0', overflowWrap: 'anywhere' }}>
                  {f.name}
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button type="button" onClick={onClose} style={buttonStyle(true)}>
                {t('common.done')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p style={{ ...hintStyle, marginTop: 4, marginBottom: 14 }}>
              {t('pageExport.savePrompt', { summary, title })}
            </p>

            {quick.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {quick.map((q) => (
                  <button
                    key={q.key}
                    type="button"
                    title={q.path}
                    aria-pressed={selected === q.path}
                    onClick={() => setSelected(q.path)}
                    style={chipStyle(selected === q.path)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}

            <FolderTree
              testId="save-tree"
              selected={selected}
              onSelect={setSelected}
              revealPath={beside}
              onLoaded={onLoaded}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              {selected ? (
                <span style={{ ...labelStyle, fontWeight: 400, overflowWrap: 'anywhere' }}>
                  {t('pageExport.saveInto', { folder: selected })}
                </span>
              ) : (
                <span style={hintStyle}>{t('pageExport.pickFolder')}</span>
              )}
              {pdfIntoTokens && (
                <span style={warnStyle} role="alert">
                  {t('pageExport.pdfIntoTokens')}
                </span>
              )}
              {error && (
                <span style={errorStyle} role="alert">
                  {error}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={onClose} disabled={busy} style={buttonStyle(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                style={buttonStyle(true, !canSave)}
              >
                {busy && <Spinner size={13} />}
                {busy ? t('pageExport.saving') : t('pageExport.saveHere')}
              </button>
            </div>
          </>
        )}
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
  boxSizing: 'border-box',
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
}
