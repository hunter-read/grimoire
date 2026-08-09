import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuSearch,
  LuMap,
  LuMusic,
  LuUser,
  LuBookOpen,
  LuChevronDown,
  LuChevronRight,
} from 'react-icons/lu'
import api from '../api'
import Spinner from '../components/Spinner'
import BookGroup from '../components/search/BookGroup'
import ResultCard from '../components/search/ResultCard'
import { sectionHeadStyle, controlStyle } from '../components/search/searchStyles'

export default function SearchView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [systemFilter, setSystemFilter] = useState('')
  const [sortBy, setSortBy] = useState('relevance')
  const timerRef = useRef(null)

  const toggleSection = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))

  const doSearch = useCallback((q) => {
    if (q.length < 2) {
      setResults(null)
      return
    }
    setSearching(true)
    api
      .get(`/search?q=${encodeURIComponent(q)}`)
      .then((r) => {
        setResults(r)
        setSystemFilter('')
        setSearching(false)
      })
      .catch(() => setSearching(false))
  }, [])

  // Run the search immediately on mount if the URL already has a query (e.g. back navigation).
  useEffect(() => {
    const initial = searchParams.get('q')
    if (initial && initial.length >= 2) doSearch(initial)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = (e) => {
    const v = e.target.value
    setQuery(v)
    setSearchParams(v ? { q: v } : {}, { replace: true })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(v), 350)
  }

  // Collect distinct game systems from book results for the filter dropdown
  const availableSystems = useMemo(() => {
    if (!results?.results?.length) return []
    const seen = new Map()
    for (const r of results.results) {
      if (r.game_system_id && !seen.has(r.game_system_id)) {
        seen.set(r.game_system_id, r.game_system)
      }
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [results])

  // Filter + sort + group book results client-side
  const groupedBooks = useMemo(() => {
    if (!results?.results) return []

    let books = systemFilter
      ? results.results.filter((r) => r.game_system_id === systemFilter)
      : results.results

    // Group pages by book
    const byBook = new Map()
    for (const r of books) {
      const key = r.id
      if (!byBook.has(key)) {
        byBook.set(key, { id: r.id, title: r.title, game_system: r.game_system, pages: [] })
      }
      byBook.get(key).pages.push({ page_number: r.page_number, snippet: r.snippet })
    }

    let groups = [...byBook.values()]

    if (sortBy === 'title') {
      groups.sort((a, b) => a.title.localeCompare(b.title))
    }
    // sortBy === 'relevance' keeps insertion order, which reflects FTS rank from backend

    return groups
  }, [results, systemFilter, sortBy])

  const totalFiltered =
    groupedBooks.reduce((s, g) => s + g.pages.length, 0) +
    (results?.maps?.length ?? 0) +
    (results?.tokens?.length ?? 0) +
    (results?.audio?.length ?? 0)

  return (
    <div
      className="fade-in"
      style={{
        padding: 'clamp(20px, 4vw, 32px) clamp(16px, 4vw, 40px)',
        maxWidth: 1000,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      <h2 style={{ fontSize: 28, marginBottom: 24 }}>{t('search.title')}</h2>

      <div style={{ position: 'relative', marginBottom: 28 }}>
        <input
          id="search-view-input"
          type="text"
          value={query}
          onChange={handleInput}
          placeholder={t('search.placeholder')}
          aria-label={t('search.ariaLabel')}
          style={{
            width: '100%',
            fontSize: 16,
            padding: '14px 20px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}
          autoFocus
        />
        <div
          style={{
            position: 'absolute',
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
          }}
        >
          {searching ? (
            <Spinner size={20} />
          ) : (
            <LuSearch size={18} style={{ color: 'var(--text-muted)' }} />
          )}
        </div>
      </div>

      {results &&
        (() => {
          const maps = results.maps ?? []
          const tokens = results.tokens ?? []
          const audio = results.audio ?? []

          return (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                  marginBottom: 20,
                }}
              >
                <span style={{ fontSize: 15, color: 'var(--text-muted)', marginRight: 'auto' }}>
                  {t('search.results', { count: totalFiltered, query: results.query })}
                </span>

                {availableSystems.length > 1 && (
                  <select
                    id="search-system-filter"
                    value={systemFilter}
                    onChange={(e) => setSystemFilter(e.target.value)}
                    aria-label={t('search.filterSystem')}
                    style={controlStyle}
                  >
                    <option value="">{t('search.allSystems')}</option>
                    {availableSystems.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}

                {results.results?.length > 0 && (
                  <select
                    id="search-sort"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    aria-label={t('common.sort')}
                    style={controlStyle}
                  >
                    <option value="relevance">{t('search.sortRelevance')}</option>
                    <option value="title">{t('search.sortTitle')}</option>
                  </select>
                )}
              </div>

              {groupedBooks.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <button onClick={() => toggleSection('books')} style={sectionHeadStyle}>
                    {collapsed.books ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
                    <LuBookOpen size={14} /> {t('search.books')}
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>
                      {groupedBooks.length}
                    </span>
                  </button>
                  {!collapsed.books &&
                    groupedBooks.map((group) => (
                      <BookGroup
                        key={group.id}
                        group={group}
                        collapsed={collapsed}
                        onToggle={toggleSection}
                        onNavigate={(page) =>
                          navigate(`/library/book/${group.id}?page=${page}`, {
                            state: { from: window.location.pathname + window.location.search },
                          })
                        }
                      />
                    ))}
                </div>
              )}

              {maps.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <button onClick={() => toggleSection('maps')} style={sectionHeadStyle}>
                    {collapsed.maps ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
                    <LuMap size={14} /> {t('search.maps')}
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>
                      {maps.length}
                    </span>
                  </button>
                  {!collapsed.maps &&
                    maps.map((m) => (
                      <ResultCard
                        key={m.id}
                        to={`/maps/${m.id}`}
                        title={m.filename}
                        subtitle={m.relative_path}
                        tags={m.tags}
                        onOpen={() => navigate(`/maps/${m.id}`)}
                      />
                    ))}
                </div>
              )}

              {tokens.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <button onClick={() => toggleSection('tokens')} style={sectionHeadStyle}>
                    {collapsed.tokens ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
                    <LuUser size={14} /> {t('search.tokens')}
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>
                      {tokens.length}
                    </span>
                  </button>
                  {!collapsed.tokens &&
                    tokens.map((tok) => (
                      <ResultCard
                        key={tok.id}
                        to={`/tokens/${tok.id}`}
                        title={tok.filename}
                        subtitle={tok.relative_path}
                        tags={tok.tags}
                        onOpen={() => navigate(`/tokens/${tok.id}`)}
                      />
                    ))}
                </div>
              )}

              {audio.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <button onClick={() => toggleSection('audio')} style={sectionHeadStyle}>
                    {collapsed.audio ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
                    <LuMusic size={14} /> {t('search.audio')}
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>
                      {audio.length}
                    </span>
                  </button>
                  {!collapsed.audio &&
                    audio.map((a) => (
                      <ResultCard
                        key={a.id}
                        to={`/audio/${a.id}`}
                        title={a.title || a.filename}
                        subtitle={a.relative_path}
                        tags={a.tags}
                        onOpen={() => navigate(`/audio/${a.id}`)}
                      />
                    ))}
                </div>
              )}

              {totalFiltered === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {t('search.noResults')}
                </div>
              )}
            </div>
          )
        })()}

      {!results && !searching && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <LuSearch size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
          <p style={{ fontFamily: 'Alegreya, serif', fontStyle: 'italic', fontSize: 16 }}>
            {t('search.emptyHint')}
          </p>
          <p style={{ fontSize: 15, marginTop: 8 }}>{t('search.emptyHint2')}</p>
        </div>
      )}
    </div>
  )
}
