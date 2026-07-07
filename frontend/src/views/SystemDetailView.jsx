import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useSessionState from '../hooks/useSessionState'
import { useTranslation } from 'react-i18next'
import {
  LuArrowLeft,
  LuPencil,
  LuClipboard,
  LuFileText,
  LuFolderOpen,
  LuSearch,
  LuX,
  LuChevronDown,
  LuChevronRight,
  LuDownload,
  LuHeart,
  LuListChecks,
} from 'react-icons/lu'
import api from '../api'
import DownloadArchiveModal from '../components/DownloadArchiveModal'
import BulkActionBar from '../components/BulkActionBar'
import AddToCampaignModal from '../components/AddToCampaignModal'
import BulkEditModal from '../components/BulkEditModal'
import useBulkSelection from '../hooks/useBulkSelection'

import { useAuth } from '../context/AuthContext'
import { useFavorites } from '../context/FavoritesContext'
import Spinner from '../components/Spinner'
import Tag from '../components/Tag'
import BookRow from '../components/system/BookRow'
import BookEditor from '../components/system/BookEditor'
import SystemEditor from '../components/system/SystemEditor'
import BookFolderGroup from '../components/system/BookFolderGroup'
import RescanButton from '../components/RescanButton'
import FavoriteButton from '../components/FavoriteButton'
import ViewModeToggle from '../components/ViewModeToggle'
import useViewMode from '../hooks/useViewMode'
import { CATEGORY_ICONS, CATEGORY_ORDER } from '../constants'

/** Extract the subfolder name from a book's relative_path.
 *  Path structure: books/{SystemName}/{categoryDir}/{SubFolder}/book.pdf
 *  Returns the subfolder name, or null if the book sits directly in the category dir. */
function getBookSubfolder(book) {
  const parts = (book.relative_path || '').replace(/\\/g, '/').split('/')
  // parts[0]=books, parts[1]=SystemName, parts[2]=category dir, parts[3]=subfolder or filename
  return parts.length > 4 ? parts[3] : null
}

/** The library-root-relative folder a book lives in (its relative_path minus the
 *  filename), e.g. "books/D&D 5e/adventure/Curse of Strahd". Used as the rescan scope. */
function bookFolderScope(book) {
  const parts = (book.relative_path || '').replace(/\\/g, '/').split('/')
  return parts.slice(0, -1).join('/')
}

/** The "books/{SystemName}" scope for a whole system, derived from any of its books. */
function systemScope(books) {
  const ref = (books || []).find((b) => b.relative_path)
  if (!ref) return null
  const parts = ref.relative_path.replace(/\\/g, '/').split('/')
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
}

/** The deepest common folder scope shared by a group of books (their category or
 *  subfolder dir). Falls back to the system scope when paths diverge. */
function groupScope(books) {
  const dirs = (books || []).map(bookFolderScope).filter(Boolean)
  if (dirs.length === 0) return null
  const split = dirs.map((d) => d.split('/'))
  const common = []
  for (let i = 0; i < split[0].length; i++) {
    const seg = split[0][i]
    if (split.every((p) => p[i] === seg)) common.push(seg)
    else break
  }
  return common.length >= 2 ? common.join('/') : systemScope(books)
}

export default function SystemDetailView() {
  const { t } = useTranslation()
  const { systemId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isFavorite } = useFavorites()
  const isEditor = user?.role === 'admin' || user?.role === 'gm'
  const [system, setSystem] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editingBookId, setEditingBookId] = useState(null)
  const [collapsedCats, setCollapsedCats] = useSessionState(
    `grimoire:system:${systemId}:collapsed`,
    new Set()
  )
  const [collapsedSubfolders, setCollapsedSubfolders] = useSessionState(
    `grimoire:system:${systemId}:subfolders`,
    new Set()
  )
  const [selectedTags, setSelectedTags] = useState(new Set())
  const [showAllTags, setShowAllTags] = useState(false)
  const [bookSort, setBookSort] = useState('title')
  const [favOnly, setFavOnly] = useState(false)
  const [viewMode, cycleViewMode] = useViewMode('book')
  const [searchQuery, setSearchQuery] = useSessionState(
    `grimoire:system:${systemId}:search-query`,
    ''
  )
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef(null)
  const [downloadModal, setDownloadModal] = useState(null)

  // Bulk multiselect (books only)
  const bulk = useBulkSelection()
  const { bulkMode, selectedIds: selectedBookIds, count: totalSelected } = bulk
  const [bulkApplying, setBulkApplying] = useState(false)
  const [showAddToCampaign, setShowAddToCampaign] = useState(false)
  const [showBulkEdit, setShowBulkEdit] = useState(false)

  useEffect(() => {
    api.get(`/systems/${systemId}`).then(setSystem)
  }, [systemId])

  const doSearch = useCallback(
    (q) => {
      if (q.length < 2) {
        setSearchResults(null)
        return
      }
      setSearching(true)
      api
        .get(`/search?q=${encodeURIComponent(q)}&system_id=${systemId}`)
        .then((r) => {
          setSearchResults(r)
          setSearching(false)
        })
        .catch(() => setSearching(false))
    },
    [systemId]
  )

  // Re-run the search on mount if a query was persisted from a previous visit.
  useEffect(() => {
    if (searchQuery && searchQuery.length >= 2) doSearch(searchQuery)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchInput = (e) => {
    const v = e.target.value
    setSearchQuery(v)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(v), 350)
  }

  const clearSearch = () => {
    setSearchQuery('')
    setSearchResults(null)
  }

  if (!system)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  const allTags = [...new Set((system.books || []).flatMap((b) => b.tags || []))].sort()

  // Distinct category slugs already in use across this system's books, so the
  // book editor can offer them for consistent reuse alongside the defaults.
  const existingCategories = [
    ...new Set((system.books || []).map((b) => b.category).filter(Boolean)),
  ].sort()

  const toggleTag = (tag) =>
    setSelectedTags((prev) => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })

  const sortBooks = (books) => {
    const sorted = [...books]
    if (bookSort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title))
    if (bookSort === 'year') sorted.sort((a, b) => (b.year || 0) - (a.year || 0))
    if (bookSort === 'size') sorted.sort((a, b) => (b.file_size || 0) - (a.file_size || 0))
    if (bookSort === 'pages') sorted.sort((a, b) => (b.page_count || 0) - (a.page_count || 0))
    return sorted
  }

  const categories = {}
  ;(system.books || [])
    .filter(
      (book) =>
        (selectedTags.size === 0 ||
          [...selectedTags].every((tag) => (book.tags || []).includes(tag))) &&
        (!favOnly || isFavorite('book', book.id))
    )
    .forEach((book) => {
      const cat = book.category || 'core'
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(book)
    })

  const allCatKeys = Object.keys(categories)
  const collapseAll = () => setCollapsedCats(new Set(allCatKeys))
  const expandAll = () => setCollapsedCats(new Set())

  // Flat ordered list of visible book ids (category render order), for
  // shift-range selection.
  const orderedBookIds = [
    ...CATEGORY_ORDER,
    ...allCatKeys.filter((c) => !CATEGORY_ORDER.includes(c)),
  ]
    .filter((cat) => categories[cat])
    .flatMap((cat) => sortBooks(categories[cat]).map((b) => b.id))
  const toggleBookSelect = (id, mods = {}) =>
    bulk.toggleItem(id, { ...mods, orderedIds: orderedBookIds })

  const selectedBookObjects = () => (system.books || []).filter((b) => selectedBookIds.has(b.id))

  const applyBulkTags = async (newTags) => {
    if (!newTags.length || totalSelected === 0 || bulkApplying) return
    setBulkApplying(true)
    const updates = {}
    await Promise.all(
      [...selectedBookIds].map((id) => {
        const book = (system.books || []).find((b) => b.id === id)
        if (!book) return null
        const merged = [...new Set([...(book.tags || []), ...newTags])]
        updates[id] = { tags: merged }
        return api.patch(`/books/${id}`, { tags: merged })
      })
    )
    setSystem((s) => ({
      ...s,
      books: s.books.map((b) => (updates[b.id] ? { ...b, ...updates[b.id] } : b)),
    }))
    bulk.clear()
    setBulkApplying(false)
  }

  const applyBookEdits = (edited) =>
    setSystem((s) => ({
      ...s,
      books: s.books.map((b) => (edited[b.id] ? { ...b, ...edited[b.id] } : b)),
    }))

  const SORT_OPTIONS = [
    ['title', t('common.sortAZ')],
    ['year', t('common.sortYear')],
    ['pages', t('common.sortPages')],
    ['size', t('common.sortSize')],
  ]

  // Book view mode → layout flags shared with BookRow / BookFolderGroup.
  const card = viewMode === 'card'
  const compact = viewMode === 'compact'
  const list = viewMode === 'list'
  // Container for a list of books in the current view mode.
  const booksContainerStyle = list
    ? { display: 'flex', flexDirection: 'column', gap: 8 }
    : {
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? '140px' : '200px'}, 1fr))`,
        gap: compact ? 12 : 16,
      }

  return (
    <div
      className="fade-in"
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
    >
      <div
        style={{
          padding: '32px 40px',
          maxWidth: 1200,
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
          flex: 1,
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <button
            onClick={() => navigate('/library')}
            style={{
              background: 'none',
              color: 'var(--text-dim)',
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 16,
            }}
          >
            <LuArrowLeft size={15} /> {t('systemDetail.backToLibrary')}
          </button>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: 32, marginBottom: 8 }}>{system.name}</h2>
              {system.publishers?.length > 0 && (
                <div style={{ fontSize: 16, color: 'var(--text-dim)', marginBottom: 8 }}>
                  {t('systemDetail.publishedBy')}{' '}
                  {system.publishers.map((p, i) => (
                    <span key={i}>
                      {i > 0 && ', '}
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener">
                          {p.name}
                        </a>
                      ) : (
                        p.name
                      )}
                    </span>
                  ))}
                </div>
              )}
              {system.description && (
                <p
                  style={{
                    fontSize: 16,
                    color: 'var(--text-dim)',
                    lineHeight: 1.6,
                    fontFamily: 'Alegreya, serif',
                    marginBottom: 12,
                  }}
                >
                  {system.description}
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginBottom: 8 }}>
                {(system.tags || []).map((tag) => (
                  <Tag key={tag} label={tag} />
                ))}
                {system.genre && <Tag label={system.genre} color="rgba(90, 154, 90, 0.2)" />}
              </div>
            </div>

            <div
              className="system-header-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 8,
                minWidth: 0,
              }}
            >
              {system.character_builder_url && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                  }}
                >
                  <a
                    href={system.character_builder_url}
                    target="_blank"
                    rel="noopener"
                    style={{
                      padding: '8px 16px',
                      borderRadius: 6,
                      fontSize: 15,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      color: 'var(--gold)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <LuClipboard size={14} /> {t('systemDetail.characterBuilder')}
                  </a>
                </div>
              )}
              {/* Search bar */}
              <div style={{ position: 'relative' }}>
                <LuSearch
                  size={13}
                  style={{
                    position: 'absolute',
                    left: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id="system-detail-search"
                  type="text"
                  aria-label={t('systemDetail.searchWithin', { name: system.name })}
                  value={searchQuery}
                  onChange={handleSearchInput}
                  placeholder={t('systemDetail.searchWithin', { name: system.name })}
                  style={{
                    width: '100%',
                    fontSize: 13,
                    padding: '6px 28px 6px 30px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    boxSizing: 'border-box',
                  }}
                />
                {searching && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                    }}
                  >
                    <Spinner size={14} />
                  </div>
                )}
                {searchQuery && !searching && (
                  <button
                    onClick={clearSearch}
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      padding: 0,
                    }}
                  >
                    <LuX size={12} />
                  </button>
                )}
              </div>
              {/* Row 1: Favorite, Edit, Download All */}
              <div
                className="system-btn-row"
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <FavoriteButton
                  type="system"
                  id={system.id}
                  style={{
                    position: 'static',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                  }}
                />
                <ViewModeToggle mode={viewMode} onCycle={cycleViewMode} style={toolBtnStyle} />
                {isEditor && (
                  <button
                    onClick={() => setEditing(!editing)}
                    style={{
                      ...toolBtnStyle,
                      color: editing ? 'var(--gold)' : 'var(--text-dim)',
                      outline: editing ? '1px solid var(--gold-dim)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <LuPencil size={13} />
                    {editing ? t('systemDetail.done') : t('common.edit')}
                  </button>
                )}
                {isEditor && (
                  <button
                    onClick={bulkMode ? bulk.exit : bulk.enter}
                    style={{
                      ...toolBtnStyle,
                      color: bulkMode ? 'var(--gold)' : 'var(--text-dim)',
                      outline: bulkMode ? '1px solid var(--gold-dim)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <LuListChecks size={13} />
                    {bulkMode ? t('systemDetail.done') : t('common.select')}
                  </button>
                )}
                <button
                  onClick={() =>
                    setDownloadModal({
                      title: t('systemDetail.downloadAllTitle'),
                      params: { type: 'system', id: system.id },
                    })
                  }
                  style={{ ...toolBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  title={t('systemDetail.downloadAllTitle')}
                >
                  <LuDownload size={13} /> {t('systemDetail.downloadAll')}
                </button>
                {isEditor && (
                  <RescanButton
                    scope={systemScope(system.books)}
                    compact={false}
                    label={t('rescan.button.label')}
                  />
                )}
              </div>
              {/* Row 2: Collapse / Expand */}
              <div
                className="system-btn-row"
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <button
                  onClick={collapseAll}
                  disabled={!!searchResults || collapsedCats.size === allCatKeys.length}
                  style={{
                    ...toolBtnStyle,
                    opacity: !!searchResults || collapsedCats.size === allCatKeys.length ? 0.4 : 1,
                  }}
                >
                  {t('systemDetail.collapseAll')}
                </button>
                <button
                  onClick={expandAll}
                  disabled={!!searchResults || collapsedCats.size === 0}
                  style={{
                    ...toolBtnStyle,
                    opacity: !!searchResults || collapsedCats.size === 0 ? 0.4 : 1,
                  }}
                >
                  {t('systemDetail.expandAll')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Edit Panel */}
        {editing && (
          <SystemEditor
            system={system}
            onSave={(updated) => {
              setSystem({ ...system, ...updated })
              setEditing(false)
            }}
          />
        )}

        {/* Tag filter row */}
        {!searchResults && allTags.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginBottom: 24,
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text-muted)', marginRight: 4 }}>
              {t('systemDetail.tagsLabel')}
            </span>
            {(showAllTags ? allTags : allTags.slice(0, 15)).map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                style={{
                  fontSize: 13,
                  padding: '3px 10px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  border: 'none',
                  background: selectedTags.has(tag) ? 'rgba(201,168,76,0.2)' : 'var(--tag-bg)',
                  color: selectedTags.has(tag) ? 'var(--gold)' : 'var(--text-dim)',
                  outline: selectedTags.has(tag)
                    ? '1px solid var(--gold-dim)'
                    : '1px solid var(--tag-border)',
                }}
              >
                {tag.charAt(0).toUpperCase() + tag.slice(1)}
              </button>
            ))}
            {allTags.length > 15 && (
              <button
                onClick={() => setShowAllTags((v) => !v)}
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: 'none',
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                }}
              >
                {showAllTags
                  ? t('systemDetail.showLess')
                  : t('common.showMore', { count: allTags.length - 15 })}
              </button>
            )}
            {selectedTags.size > 0 && (
              <button
                onClick={() => setSelectedTags(new Set())}
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <LuX size={11} /> {t('systemDetail.clearTags')}
              </button>
            )}
          </div>
        )}

        {/* Sort bar */}
        {!searchResults && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>
              {t('common.sort')}
            </span>
            {SORT_OPTIONS.map(([val, label]) => (
              <button
                key={val}
                onClick={() => setBookSort(val)}
                style={{
                  fontSize: 12,
                  padding: '3px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: bookSort === val ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: bookSort === val ? 'var(--gold)' : 'var(--text-dim)',
                }}
              >
                {label}
              </button>
            ))}
            <div style={{ marginLeft: 'auto' }}>
              <button
                onClick={() => setFavOnly((v) => !v)}
                aria-pressed={favOnly}
                title={t('favorites.onlyFavorites')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: favOnly ? 'rgba(180,120,60,0.15)' : 'var(--bg-card)',
                  color: favOnly ? 'var(--gold)' : 'var(--text-muted)',
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <LuHeart size={12} fill={favOnly ? 'var(--gold)' : 'none'} />
                {t('favorites.onlyFavorites')}
              </button>
            </div>
          </div>
        )}

        {/* Search results */}
        {searchResults && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('systemDetail.results', {
                count: searchResults.total,
                query: searchResults.query,
              })}
            </div>
            {searchResults.total === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                {t('systemDetail.noResultsFound')}
              </div>
            )}
            {searchResults.results.map((r, i) => (
              <div
                key={i}
                onClick={() =>
                  navigate(`/library/book/${r.id}?page=${r.page_number}`, {
                    state: { from: window.location.pathname },
                  })
                }
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 14,
                  marginBottom: 8,
                  cursor: 'pointer',
                }}
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
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{r.title}</span>
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--text-muted)',
                      flexShrink: 0,
                      marginLeft: 12,
                    }}
                  >
                    {t('common.pagePrefixed', { page: r.page_number })}
                  </span>
                </div>
                <div
                  style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Books by category */}
        {!searchResults &&
          [...CATEGORY_ORDER, ...Object.keys(categories).filter((c) => !CATEGORY_ORDER.includes(c))]
            .filter((cat) => categories[cat])
            .map((cat) => {
              const books = sortBooks(categories[cat])
              const CatIcon = CATEGORY_ICONS[cat] || LuFileText
              const isCollapsed = collapsedCats.has(cat)
              const catLabel = t(`categories.${cat}`, {
                defaultValue: cat.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
              })
              const toggleCat = () =>
                setCollapsedCats((prev) => {
                  const next = new Set(prev)
                  next.has(cat) ? next.delete(cat) : next.add(cat)
                  return next
                })
              return (
                <div key={cat} style={{ marginBottom: 32 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: isCollapsed ? 0 : 16,
                    }}
                  >
                    <button
                      onClick={toggleCat}
                      aria-expanded={!isCollapsed}
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px 0',
                        textAlign: 'left',
                      }}
                    >
                      {isCollapsed ? (
                        <LuChevronRight size={15} color="var(--gold-dim)" />
                      ) : (
                        <LuChevronDown size={15} color="var(--gold-dim)" />
                      )}
                      <CatIcon size={15} color="var(--gold-dim)" />
                      <span style={{ fontSize: 17, color: 'var(--gold-dim)', fontWeight: 600 }}>
                        {catLabel}
                      </span>
                      <span
                        style={{
                          fontSize: 14,
                          color: 'var(--text-muted)',
                          fontFamily: 'Alegreya Sans, sans-serif',
                          fontWeight: 400,
                        }}
                      >
                        ({books.length})
                      </span>
                    </button>
                    <button
                      onClick={() =>
                        setDownloadModal({
                          title: `${catLabel} — ${system.name}`,
                          params: { type: 'system_category', id: system.id, category: cat },
                        })
                      }
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        borderRadius: 5,
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-card)',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                      title={t('systemDetail.download')}
                    >
                      <LuDownload size={11} /> {t('systemDetail.download')}
                    </button>
                    {isEditor && <RescanButton scope={groupScope(books)} />}
                  </div>
                  {!isCollapsed &&
                    (() => {
                      // Group books by subfolder (derived from relative_path).
                      // Books sitting directly in the category dir have no subfolder (key='').
                      const folderMap = {}
                      for (const book of books) {
                        const sub = getBookSubfolder(book)
                        const key = sub || ''
                        if (!folderMap[key]) folderMap[key] = []
                        folderMap[key].push(book)
                      }
                      const hasFolders = Object.keys(folderMap).some((k) => k !== '')
                      const toggleSubfolder = (key) =>
                        setCollapsedSubfolders((prev) => {
                          const next = new Set(prev)
                          next.has(key) ? next.delete(key) : next.add(key)
                          return next
                        })
                      const saveBook = (bookId, updated) =>
                        setSystem((s) => ({
                          ...s,
                          books: s.books.map((b) => (b.id === bookId ? { ...b, ...updated } : b)),
                        }))

                      if (!hasFolders) {
                        // No subfolders — render flat list
                        return (
                          <div style={booksContainerStyle}>
                            {books.map((book) => (
                              <div
                                key={book.id}
                                style={
                                  !list && editingBookId === book.id
                                    ? { gridColumn: '1 / -1' }
                                    : undefined
                                }
                              >
                                <BookRow
                                  book={book}
                                  card={card}
                                  compact={compact}
                                  onOpen={() =>
                                    navigate(`/library/book/${book.id}`, {
                                      state: { from: window.location.pathname },
                                    })
                                  }
                                  onEdit={
                                    isEditor
                                      ? () =>
                                          setEditingBookId((id) =>
                                            id === book.id ? null : book.id
                                          )
                                      : null
                                  }
                                  editing={editingBookId === book.id}
                                  bulkMode={bulkMode}
                                  selected={selectedBookIds.has(book.id)}
                                  onToggle={(mods) => toggleBookSelect(book.id, mods)}
                                />
                                {editingBookId === book.id && (
                                  <BookEditor
                                    book={book}
                                    allTags={allTags}
                                    existingCategories={existingCategories}
                                    onSave={(updated) => {
                                      saveBook(book.id, updated)
                                      setEditingBookId(null)
                                    }}
                                    onClose={() => setEditingBookId(null)}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      }

                      const sortedFolderKeys = Object.keys(folderMap).sort((a, b) => {
                        if (a === '') return -1
                        if (b === '') return 1
                        return a.localeCompare(b)
                      })
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {sortedFolderKeys.map((key) =>
                            key === '' ? (
                              // Ungrouped books (no subfolder) — render flat above the folder widgets
                              <div
                                key="__ungrouped__"
                                style={{ ...booksContainerStyle, marginBottom: 4 }}
                              >
                                {folderMap[''].map((book) => (
                                  <div
                                    key={book.id}
                                    style={
                                      !list && editingBookId === book.id
                                        ? { gridColumn: '1 / -1' }
                                        : undefined
                                    }
                                  >
                                    <BookRow
                                      book={book}
                                      card={card}
                                      compact={compact}
                                      onOpen={() =>
                                        navigate(`/library/book/${book.id}`, {
                                          state: { from: window.location.pathname },
                                        })
                                      }
                                      onEdit={
                                        isEditor
                                          ? () =>
                                              setEditingBookId((id) =>
                                                id === book.id ? null : book.id
                                              )
                                          : null
                                      }
                                      editing={editingBookId === book.id}
                                      bulkMode={bulkMode}
                                      selected={selectedBookIds.has(book.id)}
                                      onToggle={(mods) => toggleBookSelect(book.id, mods)}
                                    />
                                    {editingBookId === book.id && (
                                      <BookEditor
                                        book={book}
                                        allTags={allTags}
                                        existingCategories={existingCategories}
                                        onSave={(updated) => {
                                          saveBook(book.id, updated)
                                          setEditingBookId(null)
                                        }}
                                        onClose={() => setEditingBookId(null)}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <BookFolderGroup
                                key={key}
                                folder={key}
                                books={folderMap[key]}
                                systemId={system.id}
                                category={cat}
                                card={card}
                                compact={compact}
                                list={list}
                                booksContainerStyle={booksContainerStyle}
                                collapsed={collapsedSubfolders}
                                onToggle={toggleSubfolder}
                                editingBookId={editingBookId}
                                setEditingBookId={setEditingBookId}
                                onOpenBook={(book) =>
                                  navigate(`/library/book/${book.id}`, {
                                    state: { from: window.location.pathname },
                                  })
                                }
                                isEditor={isEditor}
                                onSaveBook={saveBook}
                                onDownload={setDownloadModal}
                                bulkMode={bulkMode}
                                selectedBookIds={selectedBookIds}
                                onToggleBook={toggleBookSelect}
                              />
                            )
                          )}
                        </div>
                      )
                    })()}
                </div>
              )
            })}

        {!searchResults && allCatKeys.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <LuFolderOpen size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
            <p>{favOnly ? t('favorites.noFavoritesInView') : t('systemDetail.noBooks')}</p>
          </div>
        )}

        {downloadModal && (
          <DownloadArchiveModal
            title={downloadModal.title}
            params={downloadModal.params}
            onClose={() => setDownloadModal(null)}
          />
        )}
      </div>

      {bulkMode && (
        <BulkActionBar
          count={totalSelected}
          applying={bulkApplying}
          onApplyTags={applyBulkTags}
          onAddToCampaign={() => setShowAddToCampaign(true)}
          onBulkEdit={() => setShowBulkEdit(true)}
          onDone={bulk.exit}
        />
      )}

      {showAddToCampaign && (
        <AddToCampaignModal
          items={selectedBookObjects().map((b) => ({ resource_type: 'book', resource_id: b.id }))}
          onClose={() => setShowAddToCampaign(false)}
          onAdded={() => {
            setShowAddToCampaign(false)
            bulk.exit()
          }}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          type="book"
          items={selectedBookObjects()}
          onClose={() => setShowBulkEdit(false)}
          onSaved={(edited) => {
            applyBookEdits(edited)
            setShowBulkEdit(false)
            bulk.exit()
          }}
        />
      )}
    </div>
  )
}

const toolBtnStyle = {
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  flexShrink: 0,
}
