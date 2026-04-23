import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuX } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'

// SQLite FTS5 snippet() output contains only <mark>…</mark> tags around matched
// terms. Render those tags as real <mark> elements without using innerHTML so that
// any < > & characters in the PDF text cannot be interpreted as HTML.
function SnippetText({ snippet }) {
  if (!snippet) return null
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g)
  return parts.map((part, i) => {
    const m = part.match(/^<mark>(.*)<\/mark>$/)
    return m ? <mark key={i}>{m[1]}</mark> : part
  })
}

export default function SearchSidebar({ bookId, onGoToPage, onClose }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const timerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const doSearch = useCallback(
    (q) => {
      if (q.length < 2) {
        setResults(null)
        return
      }
      setSearching(true)
      api
        .get(`/search?q=${encodeURIComponent(q)}&book_id=${bookId}`)
        .then((r) => {
          setResults(r)
          setSearching(false)
        })
        .catch(() => setSearching(false))
    },
    [bookId]
  )

  const handleInput = (e) => {
    const v = e.target.value
    setQuery(v)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(v), 350)
  }

  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <LuSearch size={15} color="var(--text-muted)" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInput}
          aria-label={t('searchSidebar.ariaLabel')}
          placeholder={t('searchSidebar.placeholder')}
          style={{
            flex: 1,
            fontSize: 14,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text)',
          }}
        />
        {searching && <Spinner size={14} />}
        <button
          onClick={onClose}
          aria-label={t('searchSidebar.closeSearch')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
          }}
        >
          <LuX size={15} aria-hidden="true" />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
        {results && results.total === 0 && (
          <div
            style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}
          >
            {t('searchSidebar.noResults')}
          </div>
        )}
        {results &&
          results.results.map((r, i) => (
            <button
              key={i}
              onClick={() => onGoToPage(r.page_number, query)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 6,
                cursor: 'pointer',
                color: 'var(--text)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <div style={{ fontSize: 13, color: 'var(--gold-dim)', marginBottom: 4 }}>
                p. {r.page_number}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                <SnippetText snippet={r.snippet} />
              </div>
            </button>
          ))}
        {!results && query.length < 2 && (
          <div
            style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}
          >
            {t('searchSidebar.typeToSearch')}
          </div>
        )}
      </div>
    </div>
  )
}
