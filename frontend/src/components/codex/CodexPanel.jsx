import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuDatabase, LuExternalLink, LuSend, LuUnlink } from 'react-icons/lu'
import api from '../../api'
import useCodexStatus from './useCodexStatus'
import { CODEX_FIELDS, codexFieldLabel } from './codexFields'

/**
 * Where a book or system stands in Grimoire Codex DB (issue #35), shown in its
 * editor: linked or not, a link to the Grimoire Codex DB record, and the two outbound
 * actions — send it (a new record, or chosen fields as a correction) and unlink.
 *
 * Finding and linking a record is not here: that is "Fetch metadata", where
 * Grimoire Codex DB is a built-in source and applying a result links the record.
 *
 * Like the editor's other act-immediately sections (versions, cover upload) it
 * is an unframed block above the Save row, styled at its host's scale rather
 * than as a card of its own — `compact` matches the book editor's denser type.
 *
 * `kind` is 'books' or 'systems'. `codexId` is owned by the editor, which also
 * learns of links made through Fetch metadata; `onLinkChange` reports changes
 * made here.
 */
export default function CodexPanel({ kind, resourceId, codexId, onLinkChange, compact = false }) {
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
  // A new record needs a word on where it came from: Grimoire Codex DB asks newer
  // contributors for evidence, and a reviewer needs it either way.
  const canSend = !busy && (linked ? fields.length > 0 : note.trim().length > 0)
  const s = compact ? COMPACT : REGULAR

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
    <section aria-labelledby={`codex-${resourceId}`} style={s.section}>
      <h4 id={`codex-${resourceId}`} style={s.heading}>
        <LuDatabase size={14} aria-hidden="true" />
        {t('codex.panel.title')}
      </h4>
      <p style={{ ...s.text, color: 'var(--text-muted)', margin: 0 }}>
        {linked ? (
          <a href={recordUrl} target="_blank" rel="noreferrer" style={link}>
            {t('codex.panel.linked')} <LuExternalLink size={11} aria-hidden="true" />
          </a>
        ) : (
          t('codex.panel.notLinked')
        )}
      </p>

      {!sending && (
        <div style={actionRow}>
          <button
            type="button"
            onClick={() => setSending(true)}
            disabled={busy}
            style={button(s, busy)}
          >
            <LuSend size={13} aria-hidden="true" />
            {linked ? t('codex.panel.sendCorrection') : t('codex.panel.add')}
          </button>
          {linked && (
            <button type="button" onClick={unlink} disabled={busy} style={button(s, busy)}>
              <LuUnlink size={13} aria-hidden="true" />
              {t('codex.panel.unlink')}
            </button>
          )}
        </div>
      )}

      {sending && (
        <div style={{ marginTop: 12 }}>
          {linked ? (
            <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
              <legend style={{ ...s.label, padding: 0 }}>{t('codex.panel.chooseFields')}</legend>
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
            <p style={{ ...s.text, color: 'var(--text-dim)', margin: '0 0 10px', lineHeight: 1.5 }}>
              {t(kind === 'books' ? 'codex.panel.addBookHint' : 'codex.panel.addSystemHint')}
            </p>
          )}
          <label htmlFor={`codex-note-${resourceId}`} style={s.label}>
            {linked ? t('codex.panel.noteOptional') : t('codex.panel.noteRequired')}
          </label>
          <textarea
            id={`codex-note-${resourceId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={t('codex.panel.notePlaceholder')}
            style={{ width: '100%', resize: 'vertical', fontSize: 13, boxSizing: 'border-box' }}
          />
          <div style={actionRow}>
            <button type="button" onClick={close} disabled={busy} style={button(s, busy)}>
              {t('codex.panel.cancel')}
            </button>
            <button type="button" onClick={send} disabled={!canSend} style={primary(s, canSend)}>
              {busy ? t('codex.panel.sending') : t('codex.panel.send')}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p role="status" style={{ ...s.text, color: 'var(--text-dim)', margin: '10px 0 0' }}>
          {result.status === 'applied' ? t('codex.panel.applied') : t('codex.panel.pending')}{' '}
          <a href={result.edit_url} target="_blank" rel="noreferrer" style={link}>
            {t('codex.panel.viewEdit')}
          </a>
        </p>
      )}
      {error && (
        <p role="alert" style={{ ...s.text, color: 'var(--danger)', margin: '10px 0 0' }}>
          {error}
        </p>
      )}
    </section>
  )
}

// The two hosts' own section idioms: the book editor's Versions heading and
// 12px field labels, and the system editor's 14px muted section labels. A
// hairline above sets it apart from the fields, as the Versions rows do.
//
// The heading is an h4 for the outline but must not look like one: the global
// h1-h4 rule makes headings gold Cinzel, which no neighbouring section uses.
const headingReset = { fontFamily: 'inherit', letterSpacing: 'normal' }
const divider = { borderTop: '1px solid var(--border)', paddingTop: 14 }

const COMPACT = {
  section: { ...divider, marginTop: 20 },
  heading: {
    ...headingReset,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '0 0 4px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text)',
  },
  text: { fontSize: 12 },
  label: { fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 3 },
  radius: 5,
}

const REGULAR = {
  section: { ...divider, marginTop: 16, marginBottom: 8 },
  heading: {
    ...headingReset,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '0 0 6px',
    fontSize: 14,
    fontWeight: 400,
    color: 'var(--text-muted)',
  },
  text: { fontSize: 13 },
  label: { fontSize: 14, color: 'var(--text-muted)', display: 'block', marginBottom: 4 },
  radius: 6,
}

const link = {
  color: 'var(--gold)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}

const actionRow = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }

const button = (s, busy) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: s.radius,
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text-dim)',
  fontSize: 13,
  cursor: busy ? 'default' : 'pointer',
  opacity: busy ? 0.6 : 1,
})

// Outlined rather than filled: the editor's Save sits just below, and it stays
// the one filled gold button so the two forms never read as one. Dimmed, not
// recoloured, while it cannot send.
const primary = (s, enabled) => ({
  padding: '6px 14px',
  borderRadius: s.radius,
  background: 'none',
  border: '1px solid var(--gold-dim)',
  color: 'var(--gold)',
  fontSize: 13,
  fontWeight: 600,
  cursor: enabled ? 'pointer' : 'default',
  opacity: enabled ? 1 : 0.5,
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
  fontSize: 13,
  color: 'var(--text)',
  cursor: 'pointer',
}
