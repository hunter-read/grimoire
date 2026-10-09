import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDatabase, LuExternalLink, LuSend, LuUnlink } from 'react-icons/lu'
import api from '../../api'
import useCodexStatus from './useCodexStatus'
import { CODEX_FIELDS, codexFieldLabel } from './codexFields'

/**
 * Where a book or system stands in Grimoire Codex (issue #35), shown in its
 * editor: linked or not, a link to the Codex record, and the two outbound
 * actions — send it (a new record, or chosen fields as a correction) and unlink.
 *
 * Finding and linking a record is not here: that is "Fetch metadata", where
 * Codex is a built-in source and applying a result links the record.
 *
 * `kind` is 'books' or 'systems'. `codexId` is owned by the editor, which also
 * learns of links made through Fetch metadata; `onLinkChange` reports changes
 * made here.
 */
export default function CodexPanel({ kind, resourceId, codexId, onLinkChange }) {
  const { t } = useTranslation()
  const status = useCodexStatus()
  const [sending, setSending] = useState(false)
  const [fields, setFields] = useState([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  if (!status?.enabled) return null

  const linked = !!codexId
  const recordUrl = linked ? `${status.url}/${kind}/${codexId}` : null
  const available = CODEX_FIELDS[kind]
  // A new record needs a word on where it came from: Codex asks newer
  // contributors for evidence, and a reviewer needs it either way.
  const canSend = !busy && (linked ? fields.length > 0 : note.trim().length > 0)

  const toggle = (field) =>
    setFields((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]))

  const close = () => {
    setSending(false)
    setFields([])
    setNote('')
    setError('')
  }

  const send = () => {
    setBusy(true)
    setError('')
    api
      .post(`/codex/${kind}/${resourceId}/submit`, linked ? { fields, note } : { note })
      .then((r) => {
        setResult(r)
        if (r.linked && r.codex_id !== codexId) onLinkChange?.(r.codex_id)
        close()
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const unlink = () => {
    setBusy(true)
    setError('')
    setResult(null)
    api
      .delete(`/codex/${kind}/${resourceId}/link`)
      .then(() => onLinkChange?.(null))
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <section aria-labelledby={`codex-${resourceId}`} style={panel}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <LuDatabase size={15} aria-hidden="true" style={{ color: 'var(--gold)', flexShrink: 0 }} />
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <h4 id={`codex-${resourceId}`} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            {t('codex.panel.title')}
          </h4>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            {linked ? (
              <a href={recordUrl} target="_blank" rel="noreferrer" style={link}>
                {t('codex.panel.linked')} <LuExternalLink size={11} aria-hidden="true" />
              </a>
            ) : (
              t('codex.panel.notLinked')
            )}
          </p>
        </div>
        {!sending && status.can_submit && (
          <button type="button" onClick={() => setSending(true)} disabled={busy} style={button}>
            <LuSend size={12} aria-hidden="true" />
            {linked ? t('codex.panel.sendCorrection') : t('codex.panel.add')}
          </button>
        )}
        {!sending && linked && (
          <button type="button" onClick={unlink} disabled={busy} style={button}>
            <LuUnlink size={12} aria-hidden="true" />
            {t('codex.panel.unlink')}
          </button>
        )}
      </div>

      {sending && (
        <div style={{ marginTop: 12 }}>
          {linked ? (
            <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
              <legend style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
                {t('codex.panel.chooseFields')}
              </legend>
              <div style={fieldGrid}>
                {available.map((field) => (
                  <label key={field} style={checkRow}>
                    <input
                      type="checkbox"
                      checked={fields.includes(field)}
                      onChange={() => toggle(field)}
                      style={{ accentColor: 'var(--gold)' }}
                    />
                    {codexFieldLabel(t, kind, field)}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p
              style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 8px', lineHeight: 1.5 }}
            >
              {t(kind === 'books' ? 'codex.panel.addBookHint' : 'codex.panel.addSystemHint')}
            </p>
          )}
          <label htmlFor={`codex-note-${resourceId}`} style={labelStyle}>
            {linked ? t('codex.panel.noteOptional') : t('codex.panel.noteRequired')}
          </label>
          <textarea
            id={`codex-note-${resourceId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={t('codex.panel.notePlaceholder')}
            style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={send} disabled={!canSend} style={primary(canSend)}>
              {busy ? t('codex.panel.sending') : t('codex.panel.send')}
            </button>
            <button type="button" onClick={close} disabled={busy} style={button}>
              {t('codex.panel.cancel')}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p role="status" style={{ fontSize: 12, color: 'var(--text-dim)', margin: '10px 0 0' }}>
          {result.status === 'applied' ? t('codex.panel.applied') : t('codex.panel.pending')}{' '}
          <a href={result.edit_url} target="_blank" rel="noreferrer" style={link}>
            {t('codex.panel.viewEdit')}
          </a>
        </p>
      )}
      {error && (
        <p role="alert" style={{ fontSize: 12, color: 'var(--danger)', margin: '10px 0 0' }}>
          {error}
        </p>
      )}
    </section>
  )
}

const panel = {
  marginTop: 16,
  padding: '12px 14px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-card)',
}

const link = {
  color: 'var(--gold)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}

const button = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 12px',
  borderRadius: 5,
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text-dim)',
  fontSize: 12,
  cursor: 'pointer',
}

const primary = (enabled) => ({
  ...button,
  background: enabled ? 'var(--gold-dim)' : 'var(--bg-deep)',
  borderColor: enabled ? 'var(--gold-dim)' : 'var(--border)',
  color: enabled ? 'var(--bg-deep)' : 'var(--text-muted)',
  fontWeight: 600,
  cursor: enabled ? 'pointer' : 'default',
})

const fieldGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: '4px 12px',
  marginBottom: 10,
}

const checkRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--text)',
  cursor: 'pointer',
}

const labelStyle = { fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 3 }
