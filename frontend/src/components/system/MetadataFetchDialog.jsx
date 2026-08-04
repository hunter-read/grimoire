import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuExternalLink, LuLink, LuSearch, LuTriangleAlert, LuX } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'
import {
  addedLinks,
  defaultSelection,
  formatValue,
  isMergedField,
  labelKey,
} from './metadataFieldValue'

/**
 * Review-and-merge dialog for fetching metadata from an add-on (issue #203).
 *
 * Three steps in one panel: pick a source, pick a match, then review a
 * per-field diff and apply only the fields you ticked. Fetching never writes —
 * applying is an ordinary PATCH of just the selected fields, so nothing can be
 * overwritten without an explicit choice. Fields the resource already has are
 * left unchecked by default.
 *
 * Serves both game systems and books; `resource` and `kind` decide which API
 * path is used and what the search defaults to.
 *
 * Props:
 *   resource – the game system or book being edited
 *   kind     – 'systems' | 'books' (the API collection)
 *   onApply  – (fields) => void, called after a successful PATCH. The caller
 *              owns merging them into its own form state.
 *   onClose  – () => void
 */
export default function MetadataFetchDialog({ resource, kind = 'systems', onApply, onClose }) {
  const { t } = useTranslation()
  const [sources, setSources] = useState([])
  const [sourceId, setSourceId] = useState('')
  const [query, setQuery] = useState(resource.name || resource.title || '')
  const [results, setResults] = useState(null)
  const [detail, setDetail] = useState(null)
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // "I already know exactly which one" — a pasted source URL or bare ID, which
  // skips searching entirely. Only offered by sources that can parse one.
  const [paste, setPaste] = useState('')
  const [pasting, setPasting] = useState(false)

  const activeSource = sources.find((s) => s.id === sourceId)
  const supportsPaste = !!activeSource?.supports_paste

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    api
      .get(`/${kind}/${resource.id}/metadata-sources`)
      .then((data) => {
        setSources(data.sources || [])
        if (data.sources?.length) setSourceId(data.sources[0].id)
      })
      .catch((e) => setError(e.message))
  }, [kind, resource.id])

  const runSearch = useCallback(() => {
    if (!sourceId) return
    setBusy(true)
    setError('')
    setDetail(null)
    api
      .post(`/${kind}/${resource.id}/metadata-search`, { source_id: sourceId, query })
      .then((data) => setResults(data.results || []))
      .catch((e) => {
        setError(e.message)
        setResults(null)
      })
      .finally(() => setBusy(false))
  }, [kind, sourceId, query, resource.id])

  // Both entry points — picking a search result, and pasting a link/ID — land
  // on the same review step, so they share one fetch.
  const fetchCandidate = (body) => {
    setBusy(true)
    setError('')
    api
      .post(`/${kind}/${resource.id}/metadata-fetch`, {
        source_id: sourceId,
        // Search-backed sources answer per query rather than serving a whole
        // catalogue, so echo back the query this candidate came from.
        query,
        ...body,
      })
      .then((data) => {
        setDetail(data)
        setSelected(defaultSelection(data.fields || []))
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const choose = (identity) => fetchCandidate({ identity })

  const submitPaste = () => {
    if (!paste.trim()) return
    fetchCandidate({ paste })
  }

  const toggle = (field) =>
    setSelected((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    )

  const apply = () => {
    const payload = {}
    for (const row of detail.fields) {
      if (selected.includes(row.field)) payload[row.field] = row.incoming
    }
    setBusy(true)
    api
      .patch(`/${kind}/${resource.id}`, payload)
      .then(() => {
        onApply(payload)
        onClose()
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const statusLabel = {
    only_incoming: t('metadataFetch.statusNew'),
    differs: t('metadataFetch.statusDiffers'),
    same: t('metadataFetch.statusSame'),
  }
  const statusColor = {
    only_incoming: 'var(--gold-dim)',
    differs: 'var(--warning, #d98324)',
    same: 'var(--text-muted)',
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="metadata-fetch-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 640,
          maxWidth: '94vw',
          maxHeight: '88vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <span id="metadata-fetch-title" style={{ fontSize: 16, fontWeight: 600 }}>
            {t('metadataFetch.title')}
          </span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              padding: 2,
            }}
          >
            <LuX size={16} />
          </button>
        </div>

        {sources.length === 0 && !error && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t('metadataFetch.noSources')}</p>
        )}

        {sources.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              aria-label={t('metadataFetch.source')}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--bg-deep)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
              }}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder={t('metadataFetch.searchPlaceholder')}
              aria-label={t('metadataFetch.searchPlaceholder')}
              style={{
                flex: 1,
                minWidth: 180,
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--bg-deep)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
              }}
            />
            <button
              onClick={runSearch}
              disabled={busy || !sourceId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 6,
                background: 'var(--gold-dim)',
                color: 'var(--bg-deep)',
                fontWeight: 600,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              <LuSearch size={14} />
              {t('metadataFetch.search')}
            </button>
          </div>
        )}

        {sources.length > 0 && supportsPaste && !detail && (
          <div style={{ marginBottom: 12 }}>
            {!pasting ? (
              <button
                onClick={() => setPasting(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                <LuLink size={12} />
                {t('metadataFetch.pasteToggle')}
              </button>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitPaste()}
                    placeholder={t('metadataFetch.pastePlaceholder')}
                    aria-label={t('metadataFetch.pasteLabel')}
                    autoFocus
                    style={{
                      flex: 1,
                      minWidth: 200,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'var(--bg-deep)',
                      color: 'var(--text)',
                      border: '1px solid var(--border)',
                    }}
                  />
                  <button
                    onClick={submitPaste}
                    disabled={busy || !paste.trim()}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'none',
                      color: paste.trim() ? 'var(--text)' : 'var(--text-muted)',
                      cursor: paste.trim() ? 'pointer' : 'default',
                    }}
                  >
                    {t('metadataFetch.pasteUse')}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  {t('metadataFetch.pasteHint')}
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <p
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--danger, #c0392b)',
              marginBottom: 12,
            }}
          >
            <LuTriangleAlert size={14} />
            {error}
          </p>
        )}

        {busy && <Spinner />}

        {!detail && results !== null && results.length === 0 && !busy && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t('metadataFetch.noMatches')}</p>
        )}

        {!detail && results?.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {results.map((r) => (
              <li key={r.identity} style={{ marginBottom: 6 }}>
                <button
                  onClick={() => choose(r.identity)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-deep)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        {detail && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
              {detail.fields.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                  {t('metadataFetch.nothingToApply')}
                </p>
              )}
              {detail.fields.map((row) => {
                const disabled = row.status === 'same'
                return (
                  <label
                    key={row.field}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      gap: 10,
                      alignItems: 'start',
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'var(--bg-deep)',
                      opacity: disabled ? 0.6 : 1,
                      cursor: disabled ? 'default' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(row.field)}
                      disabled={disabled}
                      onChange={() => toggle(row.field)}
                      aria-label={row.field}
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                          {t(labelKey(row.field), row.field)}
                        </span>
                        <span style={{ fontSize: 11, color: statusColor[row.status] }}>
                          {statusLabel[row.status]}
                        </span>
                      </div>
                      {row.status === 'differs' && (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--text-muted)',
                            textDecoration: 'line-through',
                            wordBreak: 'break-word',
                          }}
                        >
                          {formatValue(row.current)}
                        </div>
                      )}
                      <div style={{ fontSize: 13, wordBreak: 'break-word' }}>
                        {isMergedField(row.field)
                          ? formatValue(addedLinks(row.current, row.incoming))
                          : formatValue(row.incoming)}
                      </div>
                      {isMergedField(row.field) && row.current?.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {t('metadataFetch.keepsExisting', { count: row.current.length })}
                        </div>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>

            {detail.attribution && (
              <p
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 12,
                }}
              >
                {detail.attribution}
                {detail.url && (
                  <a
                    href={detail.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 3,
                      color: 'var(--gold-dim)',
                    }}
                  >
                    {t('metadataFetch.viewSource')}
                    <LuExternalLink size={11} />
                  </a>
                )}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={apply}
                disabled={busy || selected.length === 0}
                style={{
                  padding: '10px 24px',
                  borderRadius: 6,
                  background: selected.length ? 'var(--gold-dim)' : 'var(--bg-deep)',
                  color: selected.length ? 'var(--bg-deep)' : 'var(--text-muted)',
                  fontWeight: 600,
                  cursor: selected.length ? 'pointer' : 'default',
                }}
              >
                {t('metadataFetch.apply', { count: selected.length })}
              </button>
              <button
                onClick={() => setDetail(null)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 6,
                  background: 'none',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                {t('metadataFetch.back')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
