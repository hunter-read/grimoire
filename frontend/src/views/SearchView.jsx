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
  LuInfo,
} from 'react-icons/lu'
import api from '../api'
import Spinner from '../components/Spinner'
import BookGroup from '../components/search/BookGroup'
import BookMatchCard from '../components/search/BookMatchCard'
import ResultCard from '../components/search/ResultCard'
import SearchHelp from '../components/search/SearchHelp'
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
  const [helpOpen, setHelpOpen] = useState(false)
  const timerRef = useRef(null)
  const inputRef = useRef(null)
  const helpButtonRef = useRef(null)

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

  const runQuery = (v) => {
    setQuery(v)
    setSearchParams(v ? { q: v } : {}, { replace: true })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(v), 350)
  }

  const handleInput = (e) => runQuery(e.target.value)

  // Clicking an example in the help popover puts it in the box and runs it —
  // the syntax is learned by seeing its results, not by being told about it.
  const insertExample = (example) => {
    runQuery(example)
    setHelpOpen(false)
    inputRef.current?.focus()
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

  // Title matches respect the system dropdown too (see the render below), so
  // the count is computed from the same filtered list rather than the raw one.
  const matchedBookCount = systemFilter
    ? (results?.book_matches ?? []).filter((b) => b.game_system_id === systemFilter).length
    : (results?.book_matches?.length ?? 0)

  const totalFiltered =
    matchedBookCount +
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
          ref={inputRef}
          style={{
            width: '100%',
            fontSize: 16,
            padding: '14px 76px 14px 20px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}
          autoFocus
        />
        <div
          style={{
            position: 'absolute',
            right: 14,
            top: 'calc(50% - 1px)',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <button
            ref={helpButtonRef}
            onClick={() => setHelpOpen((open) => !open)}
            aria-label={t('search.help.open')}
            aria-expanded={helpOpen}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              color: helpOpen ? 'var(--gold-dim)' : 'var(--text-muted)',
            }}
          >
            <LuInfo size={18} />
          </button>
          <span style={{ display: 'flex', pointerEvents: 'none' }}>
            {searching ? (
              <Spinner size={20} />
            ) : (
              <LuSearch size={18} style={{ color: 'var(--text-muted)' }} />
            )}
          </span>
        </div>
        {helpOpen && (
          <SearchHelp
            onClose={() => setHelpOpen(false)}
            onInsert={insertExample}
            triggerRef={helpButtonRef}
          />
        )}
      </div>

      {results &&
        (() => {
          const maps = results.maps ?? []
          const tokens = results.tokens ?? []
          const audio = results.audio ?? []
          // Title matches respect the system dropdown like the page hits do,
          // so filtering to one system doesn't leave foreign books pinned on top.
          const bookMatches = systemFilter
            ? (results.book_matches ?? []).filter((b) => b.game_system_id === systemFilter)
            : (results.book_matches ?? [])

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

              {(bookMatches.length > 0 || groupedBooks.length > 0) && (
                <div style={{ marginBottom: 24 }}>
                  <button onClick={() => toggleSection('books')} style={sectionHeadStyle}>
                    {collapsed.books ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
                    <LuBookOpen size={14} /> {t('search.books')}
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>
                      {bookMatches.length + groupedBooks.length}
                    </span>
                  </button>
                  {!collapsed.books && (
                    <>
                      {bookMatches.map((book) => (
                        <BookMatchCard key={`match-${book.id}`} book={book} />
                      ))}
                      {groupedBooks.map((group) => (
                        <BookGroup
                          key={group.id}
                          group={group}
                          collapsed={collapsed}
                          onToggle={toggleSection}
                        />
                      ))}
                    </>
                  )}
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
                        type="map"
                        id={m.id}
                        hasThumbnail={m.has_thumbnail}
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
                        type="token"
                        id={tok.id}
                        hasThumbnail={tok.has_thumbnail}
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
                        type="audio"
                        id={a.id}
                        hasThumbnail={a.has_thumbnail}
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
