import { useState, useCallback, useRef } from 'react'
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

      {results &&
        (() => {
          const books = results.results ?? []
          const maps = results.maps ?? []
          const tokens = results.tokens ?? []
          const total = books.length + maps.length + tokens.length

          return (
            <div>
              <div style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 20 }}>
                {t('search.results', { count: total, query: results.query })}
              </div>

              {books.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <button onClick={() => toggleSection('books')} style={sectionHeadStyle}>
                    {collapsed.books ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
                    <LuBookOpen size={14} /> {t('search.books')}
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>
                      {books.length}
                    </span>
                  </button>
                  {!collapsed.books &&
                    books.map((r, i) => (
                      <div
                        key={i}
                        onClick={() => navigate(`/library/book/${r.id}?page=${r.page_number}`)}
                        style={cardStyle}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = 'var(--bg-card-hover)')
                        }
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            marginBottom: 6,
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 16 }}>{r.title}</span>
                          <span style={{ fontSize: 14, color: 'var(--text-muted)', flexShrink: 0 }}>
                            {t('common.pagePrefixed', { page: r.page_number })}
                          </span>
                        </div>
                        {r.game_system && (
                          <div style={{ fontSize: 14, color: 'var(--gold-dim)', marginBottom: 6 }}>
                            {r.game_system}
                          </div>
                        )}
                        <div
                          style={{ fontSize: 15, color: 'var(--text-dim)', lineHeight: 1.5 }}
                          dangerouslySetInnerHTML={{ __html: r.snippet }}
                        />
                      </div>
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

              {total === 0 && (
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
