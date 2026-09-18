import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuX, LuCheck, LuPlus } from 'react-icons/lu'
import { content as contentApi } from '../../api'
import Spinner from '../Spinner'
import ContentEntryDetail from './ContentEntryDetail'
import { goldBtn, ghostBtn, iconBtn, fieldInput, fieldLabel, card } from './characterStyles'

/**
 * The catalog picker: search, filter, and choose entries for a sheet.
 *
 * Opened by `content_ref` (pick one) and `content_list` (pick many), and the
 * same component serves both — `multiple` only changes whether choosing an
 * entry closes the dialog or accumulates.
 *
 * Search and filtering happen server-side. The catalog may hold thousands of
 * entries, so paging through them in the browser would mean shipping the whole
 * 5e spell list to render a picker.
 */
export default function ContentBrowser({
  schemaId,
  contentType,
  typeDefinition = {},
  multiple = false,
  chosen = [],
  onChoose,
  onClose,
}) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [facets, setFacets] = useState({})
  const [filters, setFilters] = useState({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)

  const searchRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await contentApi.browse(schemaId, contentType, {
        search,
        page,
        filters,
      })
      setEntries(result.entries || [])
      setTotal(result.total || 0)
      // Facets describe the whole catalog, so they are only refreshed when the
      // filters are not narrowing it — otherwise picking one value would empty
      // every other facet and leave no way back.
      if (!Object.keys(filters).length) setFacets(result.filters_available || {})
      setError('')
    } catch (e) {
      setError(e.message || t('characters.catalogFailed'))
    } finally {
      setLoading(false)
    }
  }, [schemaId, contentType, search, page, filters, t])

  useEffect(() => {
    load()
  }, [load])

  // Close on Escape, the way every other dialog in the app does.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    searchRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chosenIds = new Set(chosen.map((item) => item?._ref).filter(Boolean))
  const pageSize = 50
  const pages = Math.max(1, Math.ceil(total / pageSize))

  const choose = (entry) => {
    onChoose?.({ _ref: entry.entry_id, _source: entry.source })
    if (!multiple) onClose?.()
  }

  const setFilter = (field, value) => {
    setPage(1)
    setFilters((prev) => {
      const next = { ...prev }
      if (!value) delete next[field]
      else next[field] = value
      return next
    })
  }

  const label = typeDefinition.label_plural || typeDefinition.label || contentType

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('characters.browseLabel', { label })}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim-strong)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 900,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>{label}</h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('characters.entryCount', { count: total })}
          </span>
          <button onClick={onClose} aria-label={t('common.close')} style={iconBtn}>
            <LuX size={18} />
          </button>
        </header>

        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', alignItems: 'center' }}>
          <LuSearch size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => {
              setPage(1)
              setSearch(event.target.value)
            }}
            placeholder={t('characters.searchCatalog')}
            aria-label={t('characters.searchCatalog')}
            style={{ ...fieldInput, flex: 1 }}
          />
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {Object.keys(facets).length ? (
            <aside
              aria-label={t('characters.filters')}
              style={{
                width: 190,
                flexShrink: 0,
                borderRight: '1px solid var(--border)',
                padding: '0 12px 12px',
                overflowY: 'auto',
              }}
            >
              {Object.entries(facets).map(([field, options]) => (
                <div key={field} style={{ marginBottom: 14 }}>
                  <label htmlFor={`facet-${field}`} style={fieldLabel}>
                    {typeDefinition.fields?.[field]?.label || field}
                  </label>
                  <select
                    id={`facet-${field}`}
                    value={filters[field] || ''}
                    onChange={(event) => setFilter(field, event.target.value)}
                    style={fieldInput}
                  >
                    <option value="">{t('characters.filterAny')}</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.value} ({option.count})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </aside>
          ) : null}

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 12px', minWidth: 0 }}>
            {error ? (
              <p role="alert" style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            ) : loading ? (
              <Spinner />
            ) : entries.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>{t('characters.noEntries')}</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
                {entries.map((entry) => {
                  const picked = chosenIds.has(entry.entry_id)
                  return (
                    <li key={`${entry.source}:${entry.entry_id}`}>
                      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                          onClick={() => setDetail(detail === entry.entry_id ? null : entry)}
                          style={{
                            flex: 1,
                            textAlign: 'left',
                            background: 'none',
                            border: 'none',
                            color: 'var(--text)',
                            cursor: 'pointer',
                            font: 'inherit',
                            minWidth: 0,
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{entry.name}</div>
                          {entry.display ? (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {entry.display}
                            </div>
                          ) : null}
                        </button>
                        <button
                          onClick={() => choose(entry)}
                          disabled={picked && !multiple}
                          aria-label={
                            picked ? t('characters.alreadyAdded') : t('characters.addEntry')
                          }
                          title={picked ? t('characters.alreadyAdded') : t('characters.addEntry')}
                          style={
                            picked
                              ? { ...ghostBtn, padding: '6px 10px' }
                              : { ...goldBtn, padding: '6px 10px' }
                          }
                        >
                          {picked ? <LuCheck size={14} /> : <LuPlus size={14} />}
                        </button>
                      </div>
                      {detail?.entry_id === entry.entry_id ? (
                        <ContentEntryDetail entry={entry} typeDefinition={typeDefinition} />
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {pages > 1 ? (
          <footer
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: '10px 20px',
              borderTop: '1px solid var(--border)',
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={ghostBtn}
            >
              {t('characters.previous')}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('characters.pageOf', { page, pages })}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              style={ghostBtn}
            >
              {t('characters.next')}
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
