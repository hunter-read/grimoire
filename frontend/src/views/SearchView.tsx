import {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
  type ChangeEvent,
  type ComponentType,
  type CSSProperties,
  type RefObject,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuSearch,
  LuMap,
  LuMusic,
  LuBox,
  LuUser,
  LuBookOpen,
  LuChevronDown,
  LuChevronRight,
  LuInfo,
} from 'react-icons/lu'
import api, { type Schema } from '../api'
import Spinner from '../components/Spinner'
import BookGroup, { type SearchBookGroup } from '../components/search/BookGroup'
import BookMatchCardJs from '../components/search/BookMatchCard'
import ResultCardJs from '../components/search/ResultCard'
import SearchHelpJs from '../components/search/SearchHelp'
import { shouldAutoCollapse } from '../utils/autoCollapse'
import {
  sectionHeadStyle as sectionHeadStyleJs,
  controlStyle as controlStyleJs,
} from '../components/search/searchStyles'

// Still JavaScript, so TypeScript would read every destructured prop as required.
const BookMatchCard = BookMatchCardJs as ComponentType<{ book: Schema<'SearchBookMatch'> }>
const ResultCard = ResultCardJs as ComponentType<{
  to: string
  title: string
  subtitle: string
  tags: string[]
  type: string
  id: string
  hasThumbnail?: boolean
}>
const SearchHelp = SearchHelpJs as ComponentType<{
  onClose: () => void
  onInsert: (example: string) => void
  triggerRef: RefObject<HTMLButtonElement | null>
}>
const sectionHeadStyle = sectionHeadStyleJs as CSSProperties
const controlStyle = controlStyleJs as CSSProperties

type SearchResults = Schema<'SearchResponse'>

// Audio carries an embedded track title; the rest are named by their filename.
const resultTitle = (item: { title?: string | null; filename: string }) =>
  item.title || item.filename

export default function SearchView() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [systemFilter, setSystemFilter] = useState('')
  const [sortBy, setSortBy] = useState('relevance')
  const [helpOpen, setHelpOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  const helpButtonRef = useRef<HTMLButtonElement>(null)

  const doSearch = useCallback((q: string) => {
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

  const runQuery = (v: string) => {
    setQuery(v)
    setSearchParams(v ? { q: v } : {}, { replace: true })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(v), 350)
  }

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => runQuery(e.target.value)

  // Clicking an example in the help popover puts it in the box and runs it —
  // the syntax is learned by seeing its results, not by being told about it.
  const insertExample = (example: string) => {
    runQuery(example)
    setHelpOpen(false)
    inputRef.current?.focus()
  }

  // Collect distinct game systems from book results for the filter dropdown
  const availableSystems = useMemo(() => {
    if (!results?.results?.length) return []
    const seen = new Map<string, string>()
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
  const groupedBooks = useMemo((): SearchBookGroup[] => {
    if (!results?.results) return []

    const books = systemFilter
      ? results.results.filter((r) => r.game_system_id === systemFilter)
      : results.results

    // Group pages by book. The group keeps what a hit's page prefetch needs
    // (issue #640), which is the same for every hit in the book.
    const byBook = new Map<string, SearchBookGroup>()
    for (const r of books) {
      let group = byBook.get(r.id)
      if (!group) {
        group = {
          id: r.id,
          title: r.title,
          game_system: r.game_system,
          content_token: r.content_token,
          mime_type: r.mime_type,
          page_count: r.page_count,
          pages: [],
        }
        byBook.set(r.id, group)
      }
      group.pages.push({ page_number: r.page_number, snippet: r.snippet })
    }

    const groups = [...byBook.values()]

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

  // A long result list starts with its sections and book groups collapsed, so
  // the headers (with their counts) are the overview; anything the user has
  // toggled keeps their choice. See autoCollapse.js.
  const pageHitCount = groupedBooks.reduce((n, g) => n + g.pages.length, 0)
  const sectionCounts = [
    matchedBookCount + groupedBooks.length,
    results?.maps?.length ?? 0,
    results?.tokens?.length ?? 0,
    results?.audio?.length ?? 0,
    results?.models?.length ?? 0,
  ].filter((n) => n > 0)
  const resultCount =
    matchedBookCount + pageHitCount + sectionCounts.slice(1).reduce((n, c) => n + c, 0)
  const autoCollapsed: Record<string, boolean> = {}
  if (shouldAutoCollapse(resultCount, sectionCounts.length)) {
    for (const key of ['books', 'maps', 'tokens', 'audio', 'models']) autoCollapsed[key] = true
  }
  if (shouldAutoCollapse(pageHitCount, groupedBooks.length)) {
    for (const g of groupedBooks) autoCollapsed[`book-${g.id}`] = true
  }
  const shownCollapsed: Record<string, boolean> = { ...autoCollapsed, ...collapsed }
  const toggleSection = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !shownCollapsed[key] }))

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
          const models = results.models ?? []
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
                    {shownCollapsed.books ? (
                      <LuChevronRight size={14} />
                    ) : (
                      <LuChevronDown size={14} />
                    )}
                    <LuBookOpen size={14} /> {t('search.books')}
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>
                      {bookMatches.length + groupedBooks.length}
                    </span>
                  </button>
                  {!shownCollapsed.books && (
                    <>
                      {bookMatches.map((book) => (
                        <BookMatchCard key={`match-${book.id}`} book={book} />
                      ))}
                      {groupedBooks.map((group) => (
                        <BookGroup
                          key={group.id}
                          group={group}
                          collapsed={shownCollapsed}
                          onToggle={toggleSection}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}

              {[
                { key: 'maps', items: maps, Icon: LuMap, type: 'map', path: 'maps' },
                { key: 'tokens', items: tokens, Icon: LuUser, type: 'token', path: 'tokens' },
                { key: 'audio', items: audio, Icon: LuMusic, type: 'audio', path: 'audio' },
                { key: 'models', items: models, Icon: LuBox, type: 'model', path: 'models' },
              ].map(({ key, items, Icon, type, path }) =>
                items.length > 0 ? (
                  <div key={key} style={{ marginBottom: 24 }}>
                    <button onClick={() => toggleSection(key)} style={sectionHeadStyle}>
                      {shownCollapsed[key] ? (
                        <LuChevronRight size={14} />
                      ) : (
                        <LuChevronDown size={14} />
                      )}
                      <Icon size={14} /> {t(`search.${key}`)}
                      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400 }}>
                        {items.length}
                      </span>
                    </button>
                    {!shownCollapsed[key] &&
                      items.map((item) => (
                        <ResultCard
                          key={item.id}
                          to={`/${path}/${item.id}`}
                          title={resultTitle(item)}
                          subtitle={item.relative_path}
                          tags={item.tags}
                          type={type}
                          id={item.id}
                          hasThumbnail={item.has_thumbnail}
                        />
                      ))}
                  </div>
                ) : null
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
