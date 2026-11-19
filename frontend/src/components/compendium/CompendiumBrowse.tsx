import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch } from 'react-icons/lu'
import { compendium as compendiumApi, type Schema } from '../../api'
import useSessionState from '../../hooks/useSessionState'
import Spinner from '../Spinner'
import { fieldInput, fieldLabel, ghostBtn } from '../characters/characterStyles'
import CompendiumResultList from './CompendiumResultList'
import type { CompendiumRef } from './compendiumPaths'

type Browse = Schema<'CompendiumBrowseResponse'>

interface BrowseState {
  search: string
  filters: Record<string, string>
  page: number
}

const EMPTY: BrowseState = { search: '', filters: {}, page: 1 }
const PAGE_SIZE = 50

export interface CompendiumBrowseProps extends CompendiumRef {
  contentType: string
}

/**
 * One content type of a compendium: search, the type's own filters, pages.
 *
 * The same rules as the sheet's content browser - filters come from the
 * type's `filter_fields`, a `filter_depends` child waits for its parent - but
 * laid out as a page rather than a picker. What was searched and filtered is
 * kept for the session, so opening an entry and coming back lands where you
 * left off.
 */
export default function CompendiumBrowse({
  systemId,
  gameType,
  contentType,
}: CompendiumBrowseProps) {
  const { t } = useTranslation()
  const [state, setState] = useSessionState<BrowseState>(
    `grimoire:compendium:${systemId}:${contentType}`,
    EMPTY
  )
  const [result, setResult] = useState<Browse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const requestId = useRef(0)

  useEffect(() => {
    const current = ++requestId.current
    setLoading(true)
    const timer = setTimeout(
      () => {
        compendiumApi
          .browse(systemId, contentType, {
            search: state.search,
            page: state.page,
            page_size: PAGE_SIZE,
            filters: state.filters,
          })
          .then((body) => {
            if (current !== requestId.current) return
            setResult(body)
            setError('')
          })
          .catch((e: Error) => {
            if (current === requestId.current) setError(e.message || t('compendium.loadFailed'))
          })
          .finally(() => {
            if (current === requestId.current) setLoading(false)
          })
      },
      state.search ? 250 : 0
    )
    return () => clearTimeout(timer)
  }, [systemId, contentType, state, t])

  const definition = result?.content_type
  const label = definition?.label_plural || definition?.label || contentType
  const facets = result?.filters_available || {}
  const depends = definition?.filter_depends || {}
  const pages = Math.max(1, Math.ceil((result?.total || 0) / PAGE_SIZE))

  const setFilter = (field: string, value: string) =>
    setState((prev) => {
      const filters = { ...prev.filters }
      // Changing a parent clears the filters that narrow within it.
      for (const [child, parent] of Object.entries(depends)) {
        if (parent === field && value !== prev.filters[field]) delete filters[child]
      }
      if (value) filters[field] = value
      else delete filters[field]
      return { ...prev, filters, page: 1 }
    })

  return (
    <section aria-labelledby="compendium-type-heading">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 id="compendium-type-heading" style={{ margin: 0, fontSize: 22 }}>
          {label}
        </h2>
        {result ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('compendium.entryCount', { count: result.total })}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
        <LuSearch size={15} color="var(--text-muted)" aria-hidden="true" />
        <input
          type="search"
          value={state.search}
          onChange={(event) =>
            setState((prev) => ({ ...prev, search: event.target.value, page: 1 }))
          }
          placeholder={t('compendium.searchType', { label })}
          aria-label={t('compendium.searchType', { label })}
          style={{ ...fieldInput, flex: 1 }}
        />
      </div>

      {Object.keys(facets).length ? (
        <div
          role="group"
          aria-label={t('compendium.filters')}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}
        >
          {Object.entries(facets).map(([field, options]) => {
            const parent = depends[field]
            const waiting = Boolean(
              parent &&
              facets[parent]?.length &&
              !state.filters[parent] &&
              !result?.filters_without_parent?.[field]
            )
            const chosen = state.filters[field] || ''
            const selected =
              options.find((o) => String(o.value).toLowerCase() === chosen.toLowerCase())?.value ??
              chosen
            return (
              <div key={field} style={{ minWidth: 150 }}>
                <label htmlFor={`compendium-facet-${field}`} style={fieldLabel}>
                  {(definition?.fields?.[field] as { label?: string } | undefined)?.label || field}
                </label>
                <select
                  id={`compendium-facet-${field}`}
                  value={String(selected)}
                  disabled={waiting}
                  onChange={(event) => setFilter(field, event.target.value)}
                  style={fieldInput}
                >
                  <option value="">{t('compendium.filterAny')}</option>
                  {options.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                      {String(option.value)} ({option.count})
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : loading && !result ? (
        <Spinner />
      ) : !result?.entries.length ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('compendium.noEntries')}</p>
      ) : (
        <CompendiumResultList results={result.entries} systemId={systemId} gameType={gameType} />
      )}

      {pages > 1 ? (
        <nav
          aria-label={t('compendium.pages')}
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 12,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={() => setState((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            disabled={state.page <= 1}
            style={ghostBtn}
          >
            {t('compendium.previous')}
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('compendium.pageOf', { page: state.page, pages })}
          </span>
          <button
            type="button"
            onClick={() => setState((prev) => ({ ...prev, page: Math.min(pages, prev.page + 1) }))}
            disabled={state.page >= pages}
            style={ghostBtn}
          >
            {t('compendium.next')}
          </button>
        </nav>
      ) : null}
    </section>
  )
}
