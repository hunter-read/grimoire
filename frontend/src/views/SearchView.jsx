import { useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuMap, LuUser, LuBookOpen, LuChevronDown, LuChevronRight } from 'react-icons/lu'
import api from '../api'
import Spinner from '../components/Spinner'

export default function SearchView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
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

  const handleInput = (e) => {
    const v = e.target.value
    setQuery(v)
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
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
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

  const totalFiltered = groupedBooks.reduce((s, g) => s + g.pages.length, 0) +
    (results?.maps?.length ?? 0) + (results?.tokens?.length ?? 0)

  return (
    <div
      className="fade-in"
      style={{
        padding: '32px 40px',
        maxWidth: 1000,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      <h2 style={{ fontSize: 28, marginBottom: 24 }}>{t('search.title')}</h2>

      <div style={{ position: 'relative', marginBottom: 28 }}>
        <input
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

      {results && (() => {
        const maps = results.maps ?? []
        const tokens = results.tokens ?? []

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
                      onNavigate={(page) => navigate(`/library/book/${group.id}?page=${page}`)}
                      t={t}
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
                    <div
                      key={m.id}
                      onClick={() => navigate(`/maps/${m.id}`)}
                      style={cardStyle}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = 'var(--bg-card-hover)')
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
                    >
                      <div style={{ fontWeight: 500, fontSize: 15 }}>{m.filename}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
                        {m.relative_path}
                      </div>
                      {m.tags?.length > 0 && <TagList tags={m.tags} />}
                    </div>
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
                    <div
                      key={tok.id}
                      onClick={() => navigate(`/tokens/${tok.id}`)}
                      style={cardStyle}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = 'var(--bg-card-hover)')
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
                    >
                      <div style={{ fontWeight: 500, fontSize: 15 }}>{tok.filename}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
                        {tok.relative_path}
                      </div>
                      {tok.tags?.length > 0 && <TagList tags={tok.tags} />}
                    </div>
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

function BookGroup({ group, collapsed, onToggle, onNavigate, t }) {
  const key = `book-${group.id}`
  const isCollapsed = collapsed[key]
  const pageCount = group.pages.length

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => onToggle(key)}
        aria-label={isCollapsed ? t('search.expandBook', { title: group.title }) : t('search.collapseBook', { title: group.title })}
        style={{
          ...cardStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          marginBottom: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
      >
        {isCollapsed ? <LuChevronRight size={14} style={{ flexShrink: 0 }} /> : <LuChevronDown size={14} style={{ flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{group.title}</span>
          {group.game_system && (
            <span style={{ fontSize: 13, color: 'var(--gold-dim)', marginLeft: 10 }}>
              {group.game_system}
            </span>
          )}
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>
          {t('search.groupedBy', { count: pageCount })}
        </span>
      </button>

      {!isCollapsed && (
        <div style={{ marginLeft: 16, marginTop: 4, marginBottom: 4 }}>
          {group.pages.map((p, i) => (
            <div
              key={i}
              onClick={() => onNavigate(p.page_number)}
              style={{ ...cardStyle, borderLeft: '3px solid var(--border)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {t('common.pagePrefixed', { page: p.page_number })}
                </span>
              </div>
              <div
                style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}
                dangerouslySetInnerHTML={{ __html: p.snippet }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TagList({ tags }) {
  return (
    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 4,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  )
}

const sectionHeadStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  marginBottom: 10,
  color: 'var(--text-muted)',
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 0',
}

const cardStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '12px 16px',
  marginBottom: 8,
  cursor: 'pointer',
  transition: 'background 0.15s',
}

const controlStyle = {
  fontSize: 13,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  cursor: 'pointer',
}
