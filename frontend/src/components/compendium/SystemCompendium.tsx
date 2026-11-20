import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuX } from 'react-icons/lu'
import { compendium as compendiumApi, type Schema } from '../../api'
import Spinner from '../Spinner'
import { fieldInput } from '../characters/characterStyles'
import CompendiumBrowse from './CompendiumBrowse'
import CompendiumCredits from './CompendiumCredits'
import CompendiumEntryView from './CompendiumEntryView'
import CompendiumResultList from './CompendiumResultList'
import { compendiumTypePath, type CompendiumRef } from './compendiumPaths'

type Summary = Schema<'CompendiumSummary'>
type Result = Schema<'CompendiumSearchResult'>

export interface SystemCompendiumProps extends CompendiumRef {
  summary: Summary
  contentType?: string
  entryId?: string
  origin?: string | null
}

/**
 * A system's Compendium tab (issue #835): the rules content linked to it.
 *
 * Every content type with entries is listed with its count; one opens as a
 * filtered, searchable list and each entry on its own URL. A search box above
 * looks across every type at once. The packs' credits close every view, since
 * their licences require them wherever the content is shown.
 */
export default function SystemCompendium({
  systemId,
  gameType,
  summary,
  contentType,
  entryId,
  origin,
}: SystemCompendiumProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[] | null>(null)
  const [searching, setSearching] = useState(false)
  const ref = { systemId, gameType }
  const types = summary.content_types || []

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) {
      setResults(null)
      return undefined
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      compendiumApi
        .searchSystem(systemId, text)
        .then((body) => !cancelled && setResults(body.results || []))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, systemId])

  // Opening an entry from the results is the end of that search.
  useEffect(() => {
    setQuery('')
  }, [contentType, entryId])

  let body
  if (results) {
    body = (
      <section aria-label={t('compendium.searchResults')}>
        <p role="status" style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
          {t('compendium.resultCount', { count: results.length })}
        </p>
        {results.length ? (
          <CompendiumResultList
            results={results}
            systemId={systemId}
            gameType={gameType}
            showType
          />
        ) : null}
      </section>
    )
  } else if (contentType && entryId) {
    body = (
      <CompendiumEntryView {...ref} contentType={contentType} entryId={entryId} origin={origin} />
    )
  } else if (contentType) {
    body = <CompendiumBrowse key={contentType} {...ref} contentType={contentType} />
  } else if (!types.length) {
    body = (
      <p style={{ color: 'var(--text-muted)' }}>
        {summary.can_edit ? t('compendium.emptyEditor') : t('compendium.empty')}
      </p>
    )
  } else {
    body = <p style={{ color: 'var(--text-muted)' }}>{t('compendium.pickType')}</p>
  }

  return (
    <div>
      {types.length ? (
        <div style={{ position: 'relative', marginBottom: 16, maxWidth: 520 }}>
          <LuSearch
            size={14}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('compendium.searchAll')}
            aria-label={t('compendium.searchAll')}
            style={{ ...fieldInput, paddingLeft: 30, paddingRight: 30 }}
          />
          {searching ? (
            <span
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}
            >
              <Spinner size={14} />
            </span>
          ) : query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t('common.clearSearch')}
              style={{
                position: 'absolute',
                right: 6,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
              }}
            >
              <LuX size={13} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {types.length ? (
          <nav aria-label={t('compendium.types')} style={{ flex: '0 0 200px', minWidth: 0 }}>
            <ul
              role="list"
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}
            >
              {types.map((type) => {
                const active = type.name === contentType && !results
                return (
                  <li key={type.name}>
                    <Link
                      to={compendiumTypePath(ref, type.name)}
                      aria-current={active ? 'page' : undefined}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 6,
                        fontSize: 14,
                        textDecoration: 'none',
                        color: active ? 'var(--text)' : 'var(--text-dim)',
                        background: active ? 'var(--bg-card)' : 'transparent',
                        borderLeft: `2px solid ${active ? 'var(--gold)' : 'transparent'}`,
                      }}
                    >
                      <span>{type.label_plural || type.label || type.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {type.entry_count}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        ) : null}
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>{body}</div>
      </div>

      <CompendiumCredits packs={summary.packs || []} />
    </div>
  )
}
