import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuExternalLink } from 'react-icons/lu'
import api, { bookPageUrl, type Schema } from '../../api'
import { codexFieldLabel } from './codexFields'
import {
  accent,
  actionRow,
  button,
  checkRow,
  link,
  primary,
  type PanelScale,
} from './codexPanelStyles'

type Compare = Schema<'CodexCompareResponse'>
type CompareField = Schema<'CodexCompareField'>
type SubmitResult = Schema<'CodexSubmitResponse'>

interface CodexSendFormProps {
  kind: 'books' | 'systems'
  resourceId: string
  linked: boolean
  scale: PanelScale
  onSent: (result: SubmitResult) => void
  onCancel: () => void
}

// Fields worth sending: Grimoire Codex DB lacks them, or has something else.
const SENDABLE = new Set(['only_local', 'differs'])
// The only fields Grimoire Codex DB keeps a credit for: text, not facts.
const ATTRIBUTABLE = ['description', 'tags'] as const
const CREATE = 'create'
const OTHER = 'other'
const HTTP_URL = /^https?:\/\/\S+$/i

/** A field's value as one short line. */
function show(value: unknown, t: (key: string) => string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        v && typeof v === 'object'
          ? String(
              (v as { url?: string; name?: string }).url ?? (v as { name?: string }).name ?? ''
            )
          : String(v)
      )
      .filter(Boolean)
      .join(', ')
  }
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text.length > 90 ? `${text.slice(0, 89)}…` : text
}

/** The system a new book should join: an exact name match, or a new record when nothing comes close. */
function initialSystem(c: Compare): string {
  const system = c.system
  if (!system || system.codex_id) return ''
  const name = system.name.trim().toLowerCase()
  const exact = system.candidates?.find((x) => x.name.trim().toLowerCase() === name)
  if (exact) return exact.codex_id
  return system.candidates?.length ? '' : CREATE
}

/**
 * The send form of the Grimoire Codex DB panel. It compares the saved record with
 * Grimoire Codex DB first and pre-selects what differs, so a correction is
 * one click: fields Grimoire Codex DB lacks or disagrees on, a cover it has not
 * got, and the scraper the record's data came from as the source to credit.
 *
 * A new book whose game system is not linked yet also picks where it belongs:
 * an existing Grimoire Codex DB system, or its own system sent alongside.
 */
export default function CodexSendForm({
  kind,
  resourceId,
  linked,
  scale: s,
  onSent,
  onCancel,
}: CodexSendFormProps) {
  const { t } = useTranslation()
  const [compare, setCompare] = useState<Compare | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cover, setCover] = useState(false)
  const [system, setSystem] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [credit, setCredit] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api
      .get(`/codex/${kind}/${resourceId}/compare`)
      .then((raw) => {
        if (!active) return
        const c = raw as Compare
        setCompare(c)
        setSelected(new Set(c.fields.filter((f) => SENDABLE.has(f.status)).map((f) => f.field)))
        setCover(c.cover.status === 'only_local')
        setSystem(initialSystem(c))
        const found = c.attribution_sources.find((x) => x.url)
        if (found) {
          setSourceId(found.id)
          setSourceUrl(found.url)
        }
      })
      .catch((e: Error) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [kind, resourceId])

  const rows = useMemo(() => compare?.fields ?? [], [compare])
  const changes = rows.filter((f) => SENDABLE.has(f.status))
  const matching = rows.filter((f) => f.status === 'same')
  const scraper = compare?.attribution_sources.find((x) => x.id === sourceId)
  const url = sourceUrl.trim()
  const urlValid = !url || HTTP_URL.test(url)
  // Credit the text being sent, and text Grimoire Codex DB already holds unchanged.
  const creditFields = ATTRIBUTABLE.filter(
    (f) => selected.has(f) || rows.some((r) => r.field === f && r.status === 'same')
  )
  const crediting = !!scraper && credit && !!url && urlValid && creditFields.length > 0
  const needsSystem = !!compare?.system && !compare.system.codex_id
  // A new record needs fields; a correction may carry only a cover or a credit.
  const hasPayload = selected.size > 0 || (linked && (cover || crediting))
  const canSend = !!compare && !busy && hasPayload && urlValid && (!needsSystem || !!system)

  const toggle = (field: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })

  const pickSource = (id: string) => {
    setSourceId(id)
    const found = compare?.attribution_sources.find((x) => x.id === id)
    setSourceUrl(found?.url ?? (id === OTHER ? sourceUrl : ''))
  }

  const send = () => {
    setBusy(true)
    setError('')
    api
      .post(`/codex/${kind}/${resourceId}/submit`, {
        fields: [...selected],
        note,
        cover,
        sources: url ? [url] : [],
        ...(crediting && scraper
          ? { attribution: { source: scraper.name, url, fields: creditFields } }
          : {}),
        ...(needsSystem
          ? { system: system === CREATE ? { create: true } : { codex_id: system } }
          : {}),
        ...(compare?.revision ? { base_revision: compare.revision } : {}),
      })
      .then((r) => onSent(r as SubmitResult))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const fieldRow = (f: CompareField) => (
    <label key={f.field} style={checkRow}>
      <input
        type="checkbox"
        checked={selected.has(f.field)}
        onChange={() => toggle(f.field)}
        style={accent}
      />
      <span style={{ minWidth: 0 }}>
        {codexFieldLabel(t, kind, f.field)}
        {f.status === 'differs' ? (
          <>
            <span style={detail}>{t('codex.send.yours', { value: show(f.local, t) })}</span>
            <span style={detail}>{t('codex.send.theirs', { value: show(f.remote, t) })}</span>
          </>
        ) : (
          <span style={detail}>{show(f.local, t)}</span>
        )}
      </span>
    </label>
  )

  if (!compare) {
    return (
      <div style={{ marginTop: 12 }}>
        {error ? (
          <p role="alert" style={{ ...s.text, color: 'var(--danger)', margin: 0 }}>
            {error}
          </p>
        ) : (
          <p style={{ ...s.text, color: 'var(--text-dim)', margin: 0 }}>
            {t('codex.send.loading')}
          </p>
        )}
        <div style={actionRow}>
          <button type="button" onClick={onCancel} style={button(s, false)}>
            {t('codex.panel.cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 14 }}>
      {!linked && (
        <p style={{ ...s.text, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
          {t(kind === 'books' ? 'codex.panel.addBookHint' : 'codex.panel.addSystemHint')}
        </p>
      )}

      {needsSystem && compare.system && (
        <fieldset style={fieldset}>
          <legend style={{ ...s.label, padding: 0 }}>
            {t('codex.send.systemPrompt', { name: compare.system.name })}
          </legend>
          <div style={stack}>
            {(compare.system.candidates ?? []).map((c) => (
              <label key={c.codex_id} style={checkRow}>
                <input
                  type="radio"
                  name={`codex-system-${resourceId}`}
                  checked={system === c.codex_id}
                  onChange={() => setSystem(c.codex_id)}
                  style={accent}
                />
                <span>
                  {c.label}{' '}
                  <a href={c.url} target="_blank" rel="noreferrer" style={link}>
                    <LuExternalLink
                      size={11}
                      role="img"
                      aria-hidden={false}
                      aria-label={t('codex.send.viewSystem')}
                    />
                  </a>
                </span>
              </label>
            ))}
            <label style={checkRow}>
              <input
                type="radio"
                name={`codex-system-${resourceId}`}
                checked={system === CREATE}
                onChange={() => setSystem(CREATE)}
                style={accent}
              />
              {t('codex.send.systemCreate', { name: compare.system.name })}
            </label>
          </div>
        </fieldset>
      )}

      <fieldset style={fieldset}>
        <legend style={{ ...s.label, padding: 0 }}>
          {linked ? t('codex.send.changes') : t('codex.send.fields')}
        </legend>
        {changes.length === 0 &&
        compare.cover.status !== 'only_local' &&
        compare.cover.status !== 'differs' ? (
          <p style={{ ...s.text, color: 'var(--text-dim)', margin: 0 }}>
            {t('codex.send.noChanges')}
          </p>
        ) : (
          <div style={stack}>
            {changes.map(fieldRow)}
            {(compare.cover.status === 'only_local' || compare.cover.status === 'differs') && (
              <label style={checkRow}>
                <input
                  type="checkbox"
                  checked={cover}
                  onChange={() => setCover((v) => !v)}
                  style={accent}
                />
                <span style={{ minWidth: 0 }}>
                  {t('codex.send.cover')}
                  <span style={detail}>
                    {compare.cover.status === 'only_local'
                      ? t('codex.send.coverNew')
                      : t('codex.send.coverDiffers')}{' '}
                    {compare.cover.remote_url && (
                      <a
                        href={compare.cover.remote_url}
                        target="_blank"
                        rel="noreferrer"
                        style={link}
                      >
                        {t('codex.send.viewCover')}
                      </a>
                    )}
                  </span>
                  {kind === 'books' && cover && (
                    <img
                      src={bookPageUrl(resourceId, 1, 240)}
                      alt=""
                      style={{ display: 'block', marginTop: 6, width: 72, borderRadius: 3 }}
                    />
                  )}
                </span>
              </label>
            )}
          </div>
        )}
        {matching.length > 0 && (
          <details style={{ ...s.text, color: 'var(--text-dim)', marginTop: 8 }}>
            <summary style={{ cursor: 'pointer' }}>
              {t('codex.send.matching', { count: matching.length })}
            </summary>
            <div style={{ ...stack, marginTop: 6 }}>{matching.map(fieldRow)}</div>
          </details>
        )}
      </fieldset>

      <div>
        <label htmlFor={`codex-source-${resourceId}`} style={s.label}>
          {t('codex.send.source')}
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select
            id={`codex-source-${resourceId}`}
            value={sourceId}
            onChange={(e) => pickSource(e.target.value)}
            style={{ fontSize: 13, flex: '0 1 auto' }}
          >
            <option value="">{t('codex.send.sourceNone')}</option>
            {compare.attribution_sources.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
            <option value={OTHER}>{t('codex.send.sourceOther')}</option>
          </select>
          {sourceId && (
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://"
              aria-label={t('codex.send.sourceUrl')}
              aria-invalid={!urlValid}
              style={{ fontSize: 13, flex: '1 1 220px', minWidth: 0 }}
            />
          )}
        </div>
        {!urlValid && (
          <p style={{ ...s.text, color: 'var(--danger)', margin: '4px 0 0' }}>
            {t('codex.send.sourceInvalid')}
          </p>
        )}
        {scraper && creditFields.length > 0 && (
          <label style={{ ...checkRow, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={credit}
              onChange={() => setCredit((v) => !v)}
              style={accent}
            />
            <span>
              {t('codex.send.credit', {
                source: scraper.name,
                fields: creditFields.map((f) => codexFieldLabel(t, kind, f)).join(', '),
              })}
              <span style={detail}>{t('codex.send.creditHint')}</span>
            </span>
          </label>
        )}
      </div>

      <div>
        <label htmlFor={`codex-note-${resourceId}`} style={s.label}>
          {t('codex.panel.noteOptional')}
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
        <p style={{ ...s.text, color: 'var(--text-dim)', margin: '4px 0 0' }}>
          {t('codex.send.savedOnly')}
        </p>
      </div>

      {error && (
        <p role="alert" style={{ ...s.text, color: 'var(--danger)', margin: 0 }}>
          {error}
        </p>
      )}
      <div style={{ ...actionRow, marginTop: 0 }}>
        <button type="button" onClick={onCancel} disabled={busy} style={button(s, busy)}>
          {t('codex.panel.cancel')}
        </button>
        <button type="button" onClick={send} disabled={!canSend} style={primary(s, canSend)}>
          {busy ? t('codex.panel.sending') : t('codex.panel.send')}
        </button>
      </div>
    </div>
  )
}

const fieldset = { border: 'none', margin: 0, padding: 0, minWidth: 0 }
const stack = { display: 'grid', gap: 6 }
const detail = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-dim)',
  overflowWrap: 'anywhere' as const,
  marginTop: 1,
}
