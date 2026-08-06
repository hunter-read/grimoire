import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useSessionState from '../hooks/useSessionState'
import { useTranslation } from 'react-i18next'
import {
  LuArrowLeft,
  LuPencil,
  LuClipboard,
  LuFolderOpen,
  LuSearch,
  LuX,
  LuDownload,
} from 'react-icons/lu'
import api, { bulk as bulkApi } from '../api'
import DownloadArchiveModal from '../components/DownloadArchiveModal'
import BulkActionBar from '../components/BulkActionBar'
import AddToCampaignModal from '../components/AddToCampaignModal'
import BulkEditModal from '../components/BulkEditModal'
import useBulkSelection from '../hooks/useBulkSelection'

import { useAuth } from '../context/AuthContext'
import { useFavorites } from '../context/FavoritesContext'
import Spinner from '../components/Spinner'
import Tag from '../components/Tag'
import SystemEditor from '../components/system/SystemEditor'
import SystemSearchResults from '../components/system/SystemSearchResults'
import SystemCategorySection from '../components/system/SystemCategorySection'
import SystemContainerView from '../components/system/SystemContainerView'
import CategoryBookItem from '../components/system/CategoryBookItem'
import CategoryGroupToggle from '../components/system/CategoryGroupToggle'
import BulkToggleButton from '../components/BulkToggleButton'
import CollapseExpandButtons from '../components/CollapseExpandButtons'
import ToolbarButton from '../components/ToolbarButton'
import RescanButton from '../components/RescanButton'
import FavoriteButton from '../components/FavoriteButton'
import ViewModeToggle from '../components/ViewModeToggle'
import useViewMode from '../hooks/useViewMode'
import SortFilterBar from '../components/library/SortFilterBar'
import { bookFilterPredicate, bookComparator } from '../components/library/applyBookSortFilter'
import useSavedFilters from '../hooks/useSavedFilters'
import { CATEGORY_ORDER } from '../constants'
import matchBooks from '../utils/matchBooks'
import { systemDisplayName } from '../utils/systemDisplayName'
import { parentSystemLabel } from '../utils/parentSystemLabel'
import useTagLabels, { titleCaseTag } from '../hooks/useTagLabels'

const DEFAULT_BOOK_FILTER = { sort: 'title', order: 'asc', filters: {} }

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
  // Book subcategory folder tags, keyed by BookFolder path
  // ("{systemId}/{category}/{subfolder…}"). Loaded once per system; edited
  // inline on each folder group header (issue #235 follow-up).
  const [bookFolderTags, setBookFolderTags] = useState({})
  const [editingFolderKey, setEditingFolderKey] = useState(null)
  const [collapsedCats, setCollapsedCats] = useSessionState(
    `grimoire:system:${systemId}:collapsed`,
    new Set()
  )
  const [collapsedSubfolders, setCollapsedSubfolders] = useSessionState(
    `grimoire:system:${systemId}:subfolders`,
    new Set()
  )
  // Whether books are split into category sections (default) or shown as one
  // flat sorted list. Persisted per system for the session. Sort/filter state
  // is independent of this toggle.
  const [grouped, setGrouped] = useSessionState(`grimoire:system:${systemId}:grouped`, true)
  // Books sort/filter now flow through the shared SortFilterBar state, with
  // server-backed saved presets (scope "books"). Favourites/tags/explicit/genre
  // all live in filters; the category grouping below is preserved.
  const [bookFilter, setBookFilter] = useState(DEFAULT_BOOK_FILTER)
  const [defaultApplied, setDefaultApplied] = useState(false)
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
  // Shared-tag display labels for book tags (filter values match on internal key).
  const bookTagLabels = useTagLabels('book')

  useEffect(() => {
    api.get(`/systems/${systemId}`).then(setSystem)
  }, [systemId])

  // Load book subcategory folder tags for this system.
  useEffect(() => {
    api
      .get(`/systems/${systemId}/book-folders`)
      .then((r) => {
        const map = {}
        for (const f of r.folders || []) map[f.path] = f.tags || []
        setBookFolderTags(map)
      })
      .catch(() => setBookFolderTags({}))
  }, [systemId])

  const {
    saved: savedBookFilters,
    loaded: bookFiltersLoaded,
    defaultFilter: defaultBookFilter,
    save: saveBookPreset,
    setDefault: setBookPresetDefault,
    remove: removeBookPreset,
  } = useSavedFilters('books')

  // Apply the user's default books preset once on load.
  useEffect(() => {
    if (bookFiltersLoaded && !defaultApplied) {
      if (defaultBookFilter?.state) setBookFilter(defaultBookFilter.state)
      setDefaultApplied(true)
    }
  }, [bookFiltersLoaded, defaultApplied, defaultBookFilter])

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

  // Container folders hold systems, not categories (issues #261, #262), so they
  // render their children as a system grid instead of a book list. A container
  // with no children yet falls through to the normal view rather than showing an
  // empty grid — that way a half-scanned library still shows whatever it found.
  if (system.container_kind && (system.children || []).length > 0) {
    return (
      <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
        <SystemContainerView
          system={system}
          viewMode={viewMode}
          canEdit={isEditor}
          onBack={() => navigate('/library')}
          onOpenChild={(child) => navigate(`/library/system/${child.id}`)}
          onCoverChange={(cover) => setSystem((s) => ({ ...s, ...cover }))}
          headerExtra={<ViewModeToggle mode={viewMode} onCycle={cycleViewMode} />}
        />
      </div>
    )
  }

  // Special collections (system-agnostic + one-page/small RPGs) are not real
  // game systems, so they don't expose editable system metadata.
  const isSpecialCollection = system.is_system_agnostic || system.is_one_page
  const canEditSystemMeta = isEditor && !isSpecialCollection

  // A system nested in a container (issues #261, #262) was reached *through* that
  // container, so going "back" returns there rather than skipping to the library
  // root. Container names may be raw folder slugs, hence the prettified label.
  const backTarget = system.parent_id
    ? {
        to: `/library/system/${system.parent_id}`,
        label: t('systemDetail.backTo', {
          name: systemDisplayName({
            name: system.parent_name || '',
            is_one_page: system.parent_is_one_page,
          }),
        }),
      }
    : { to: '/library', label: t('systemDetail.backToLibrary') }

  const allTags = [...new Set((system.books || []).flatMap((b) => b.tags || []))].sort()

  // Distinct category slugs already in use across this system's books, so the
  // book editor can offer them for consistent reuse alongside the defaults.
  const existingCategories = [
    ...new Set((system.books || []).map((b) => b.category).filter(Boolean)),
  ].sort()

  const bookFilters = bookFilter.filters || {}
  // Derived helpers kept for the card tag-chip toggles and empty-state copy.
  const selectedTags = new Set((bookFilters.tags || []).map((tg) => tg.toLowerCase()))
  const favOnly = bookFilters.favorites === true

  const updateBookFilter = (next) => setBookFilter(next)
  const handleSaveBookPreset = (name, opts) => saveBookPreset(name, bookFilter, opts)

  // Toggle a single tag in the filter state (used by the card/tag chips).
  const toggleTag = (tag) => {
    const cur = bookFilters.tags || []
    const lower = tag.toLowerCase()
    const next = cur.some((tg) => tg.toLowerCase() === lower)
      ? cur.filter((tg) => tg.toLowerCase() !== lower)
      : [...cur, tag]
    setBookFilter({
      ...bookFilter,
      filters: { ...bookFilters, tags: next.length ? next : undefined },
    })
  }

  const comparator = bookComparator(bookFilter.sort, bookFilter.order)
  const sortBooks = (books) => [...books].sort(comparator)

  const bookMatchesFilters = bookFilterPredicate(bookFilters, {
    isFavorite: (id) => isFavorite('book', id),
  })

  const categories = {}
  ;(system.books || []).filter(bookMatchesFilters).forEach((book) => {
    const cat = book.category || 'core'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(book)
  })

  const allCatKeys = Object.keys(categories)
  const collapseAll = () => setCollapsedCats(new Set(allCatKeys))
  const expandAll = () => setCollapsedCats(new Set())

  // Category render order (built-ins first, then any custom categories).
  const orderedCatKeys = [
    ...CATEGORY_ORDER,
    ...allCatKeys.filter((c) => !CATEGORY_ORDER.includes(c)),
  ].filter((cat) => categories[cat])

  // All filtered books as a single sorted list (used by the flattened view).
  const flatBooks = sortBooks((system.books || []).filter(bookMatchesFilters))

  // Flat ordered list of visible book ids, for shift-range selection. Matches
  // the on-screen order: grouped → by category; flat → the single sorted list.
  const orderedBookIds = grouped
    ? orderedCatKeys.flatMap((cat) => sortBooks(categories[cat]).map((b) => b.id))
    : flatBooks.map((b) => b.id)
  const toggleBookSelect = (id, mods = {}) =>
    bulk.toggleItem(id, { ...mods, orderedIds: orderedBookIds })

  const selectedBookObjects = () => (system.books || []).filter((b) => selectedBookIds.has(b.id))

  // One request for the whole selection: the old per-book PATCH fan-out raced on
  // tag creation server-side and returned intermittent 500s (issue #270).
  const applyBulkTags = async (newTags) => {
    if (!newTags.length || totalSelected === 0 || bulkApplying) return
    setBulkApplying(true)
    try {
      const ids = [...selectedBookIds].filter((id) => (system.books || []).some((b) => b.id === id))
      if (!ids.length) return
      const { tags } = await bulkApi.addTags('book', ids, newTags)
      setSystem((s) => ({
        ...s,
        books: s.books.map((b) => (tags?.[b.id] ? { ...b, tags: tags[b.id] } : b)),
      }))
      bulk.clear()
    } finally {
      setBulkApplying(false)
    }
  }

  const applyBookEdits = (edited) =>
    setSystem((s) => ({
      ...s,
      books: s.books.map((b) => (edited[b.id] ? { ...b, ...edited[b.id] } : b)),
    }))

  // Shared handlers passed down to the category sections.
  const openBook = (book) =>
    navigate(`/library/book/${book.id}`, { state: { from: window.location.pathname } })

  const saveBook = (bookId, updated) =>
    setSystem((s) => ({
      ...s,
      books: s.books.map((b) => (b.id === bookId ? { ...b, ...updated } : b)),
    }))

  // Persist a book folder's tags and reflect them locally. ``path`` is the full
  // BookFolder path ("{systemId}/{category}/{subfolder…}").
  const saveBookFolderTags = (path, tags) => {
    setBookFolderTags((prev) => ({ ...prev, [path]: tags }))
    setEditingFolderKey(null)
    api.patch(`/systems/${systemId}/book-folders`, { path, tags }).catch(() =>
      api.get(`/systems/${systemId}/book-folders`).then((r) => {
        const map = {}
        for (const f of r.folders || []) map[f.path] = f.tags || []
        setBookFolderTags(map)
      })
    )
  }

  const toggleSubfolder = (key) =>
    setCollapsedSubfolders((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  // Sort + filter options for the books SortFilterBar.
  const bookSortOptions = [
    { value: 'title', label: t('sortFilter.sortTitle') },
    { value: 'year', label: t('sortFilter.sortYear') },
    { value: 'page_count', label: t('sortFilter.sortPageCount') },
    { value: 'size', label: t('sortFilter.sortSize') },
  ]
  const bookGenreOptions = [...new Set((system.books || []).flatMap((b) => b.genres || []))]
    .sort((a, b) => a.localeCompare(b))
    .map((g) => ({ value: g, label: g }))
  const bookTagOptions = allTags.map((tg) => ({
    value: tg,
    label: bookTagLabels[tg] || titleCaseTag(tg),
  }))

  // Book view mode → layout flags shared with BookRow / BookFolderGroup.
  const card = viewMode === 'card'
  const compact = viewMode === 'compact'
  const list = viewMode === 'list'

  // When searching, surface books whose title/metadata match the query above the
  // full-text page hits, honouring the same tag/favourite filters as the grid.
  const matchedBooks = searchResults
    ? matchBooks((system.books || []).filter(bookMatchesFilters), searchResults.query)
    : []
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
          padding: 'clamp(20px, 4vw, 32px) clamp(16px, 4vw, 40px)',
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
            onClick={() => navigate(backTarget.to)}
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
            <LuArrowLeft size={15} /> {backTarget.label}
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
              <h2 style={{ fontSize: 32, marginBottom: 8 }}>{systemDisplayName(system)}</h2>
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
              {/* Genres are shown before tags per issue #202. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginBottom: 8 }}>
                {(system.genres && system.genres.length
                  ? system.genres
                  : system.genre
                    ? [system.genre]
                    : []
                ).map((g) => (
                  <Tag
                    key={`genre-${g}`}
                    label={g}
                    color="rgba(90, 154, 90, 0.2)"
                    linkable={false}
                  />
                ))}
                {(system.tags || []).map((tag) => (
                  <Tag key={tag} label={tag} />
                ))}
              </div>
              {/* Parent system / family / license / year metadata line. */}
              {(parentSystemLabel(system) ||
                system.system_family ||
                system.license ||
                system.year) && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 16,
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    marginBottom: 8,
                  }}
                >
                  {parentSystemLabel(system) && (
                    <span>
                      {t('systemDetail.parentSystemLabel')}:{' '}
                      <span style={{ color: 'var(--text-dim)' }}>{parentSystemLabel(system)}</span>
                    </span>
                  )}
                  {system.system_family && (
                    <span>
                      {t('systemDetail.familyLabel')}:{' '}
                      <span style={{ color: 'var(--text-dim)' }}>{system.system_family}</span>
                    </span>
                  )}
                  {system.license && (
                    <span>
                      {t('systemDetail.licenseLabel')}:{' '}
                      <span style={{ color: 'var(--text-dim)' }}>{system.license}</span>
                    </span>
                  )}
                  {system.year && (
                    <span>
                      {t('systemDetail.yearLabel')}:{' '}
                      <span style={{ color: 'var(--text-dim)' }}>{system.year}</span>
                    </span>
                  )}
                </div>
              )}
              {system.dice_materials?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {/* Dice/materials use a distinct amber border to set them apart
                      from genres (green) and tags (default). */}
                  {system.dice_materials.map((d) => (
                    <span
                      key={d}
                      style={{
                        fontSize: 12,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: 'rgba(214, 178, 74, 0.10)',
                        border: '1px solid var(--gold)',
                        color: 'var(--gold)',
                      }}
                    >
                      {d}
                    </span>
                  ))}
                </div>
              )}
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
              {(() => {
                // Prefer the multi-value lists; fall back to the legacy single
                // character_builder_url for older data.
                const builderLinks =
                  system.character_builder_urls && system.character_builder_urls.length
                    ? system.character_builder_urls
                    : system.character_builder_url
                      ? [{ label: '', url: system.character_builder_url }]
                      : []
                const genericLinks = system.urls || []
                const allLinks = [
                  ...builderLinks.map((l) => ({ ...l, builder: true })),
                  ...genericLinks.map((l) => ({ ...l, builder: false })),
                ].filter((l) => l.url)
                if (allLinks.length === 0) return null
                return (
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                    }}
                  >
                    {allLinks.map((l, i) => (
                      <a
                        key={`${l.url}-${i}`}
                        href={l.url}
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
                        {l.builder && <LuClipboard size={14} />}
                        {l.label ||
                          (l.builder ? t('systemDetail.characterBuilder') : t('systemDetail.link'))}
                      </a>
                    ))}
                  </div>
                )
              })()}
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
              {/* Group 1: Favorite, Edit, Select Multiple, Download All, Rescan */}
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
                {canEditSystemMeta && (
                  <ToolbarButton
                    icon={<LuPencil size={13} />}
                    label={editing ? t('systemDetail.done') : t('common.edit')}
                    onClick={() => setEditing(!editing)}
                    active={editing}
                  />
                )}
                <ToolbarButton
                  icon={<LuDownload size={13} />}
                  label={t('systemDetail.downloadAll')}
                  onClick={() =>
                    setDownloadModal({
                      title: t('systemDetail.downloadAllTitle'),
                      params: { type: 'system', id: system.id },
                    })
                  }
                  title={t('systemDetail.downloadAllTitle')}
                />
                {isEditor && (
                  <RescanButton
                    scope={systemScope(system.books)}
                    compact={false}
                    label={t('rescan.button.label')}
                  />
                )}
              </div>
              {/* Group 2: View switcher, Grouping toggle, Collapse / Expand all */}
              <div
                className="system-btn-row"
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <CategoryGroupToggle grouped={grouped} onToggle={setGrouped} />
                <CollapseExpandButtons
                  onCollapseAll={collapseAll}
                  onExpandAll={expandAll}
                  collapseDisabled={
                    !!searchResults || !grouped || collapsedCats.size === allCatKeys.length
                  }
                  expandDisabled={!!searchResults || !grouped || collapsedCats.size === 0}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Edit Panel (system metadata) — never for special collections. */}
        {editing && canEditSystemMeta && (
          <SystemEditor
            system={system}
            onSave={(updated) => {
              setSystem({ ...system, ...updated })
              setEditing(false)
            }}
            // Cover uploads apply immediately, so reflect them without closing
            // the editor or discarding unsaved metadata edits.
            onCoverChange={(cover) => setSystem((s) => ({ ...s, ...cover }))}
          />
        )}

        {/* Single sticky toolbar row: sort + filters on the left, multi-select
            and view-mode on the right (#255). Hidden while showing in-book
            search results, which have their own layout. */}
        {!searchResults && (
          <SortFilterBar
            sticky
            state={bookFilter}
            onChange={updateBookFilter}
            sortOptions={bookSortOptions}
            showSearch={false}
            trailing={
              <>
                {isEditor && (
                  <BulkToggleButton
                    active={bulkMode}
                    onToggle={bulkMode ? bulk.exit : bulk.enter}
                  />
                )}
                <ViewModeToggle mode={viewMode} onCycle={cycleViewMode} style={toolBtnStyle} />
              </>
            }
            multiFilters={[
              {
                key: 'genres',
                label: t('sortFilter.filterGenre'),
                emptyLabel: t('sortFilter.noGenres'),
                options: bookGenreOptions,
              },
              {
                key: 'tags',
                label: t('sortFilter.filterTags'),
                emptyLabel: t('sortFilter.noTags'),
                options: bookTagOptions,
              },
            ]}
            toggleFilters={[
              { key: 'favorites', label: t('sortFilter.filterFavorites'), boolean: true },
              { key: 'explicit', label: t('sortFilter.filterExplicit') },
            ]}
            saved={savedBookFilters}
            onSavePreset={handleSaveBookPreset}
            onSetDefault={setBookPresetDefault}
            onDeletePreset={removeBookPreset}
          />
        )}

        <SystemSearchResults
          searchResults={searchResults}
          matchedBooks={matchedBooks}
          booksContainerStyle={booksContainerStyle}
          card={card}
          compact={compact}
          onOpenBook={(book) =>
            navigate(`/library/book/${book.id}`, {
              state: { from: window.location.pathname },
            })
          }
          onOpenPage={(r) =>
            navigate(`/library/book/${r.id}?page=${r.page_number}`, {
              state: { from: window.location.pathname },
            })
          }
        />

        {/* Books, grouped by category (default) or as one flat sorted list. */}
        {!searchResults &&
          grouped &&
          orderedCatKeys.map((cat) => (
            <SystemCategorySection
              key={cat}
              cat={cat}
              books={sortBooks(categories[cat])}
              system={system}
              isCollapsed={collapsedCats.has(cat)}
              onToggleCat={() =>
                setCollapsedCats((prev) => {
                  const next = new Set(prev)
                  next.has(cat) ? next.delete(cat) : next.add(cat)
                  return next
                })
              }
              collapsedSubfolders={collapsedSubfolders}
              onToggleSubfolder={toggleSubfolder}
              groupScope={groupScope}
              bookFolderTags={bookFolderTags}
              editingFolderKey={editingFolderKey}
              onEditFolder={setEditingFolderKey}
              onSaveBookFolderTags={saveBookFolderTags}
              editingBookId={editingBookId}
              setEditingBookId={setEditingBookId}
              allTags={allTags}
              existingCategories={existingCategories}
              systemGenres={system.genres || []}
              card={card}
              compact={compact}
              list={list}
              booksContainerStyle={booksContainerStyle}
              isEditor={isEditor}
              onOpenBook={openBook}
              onSaveBook={saveBook}
              onDownload={setDownloadModal}
              bulkMode={bulkMode}
              selectedBookIds={selectedBookIds}
              onToggleBook={toggleBookSelect}
            />
          ))}

        {!searchResults && !grouped && flatBooks.length > 0 && (
          <div style={booksContainerStyle}>
            {flatBooks.map((book) => (
              <CategoryBookItem
                key={book.id}
                book={book}
                card={card}
                compact={compact}
                list={list}
                editingBookId={editingBookId}
                setEditingBookId={setEditingBookId}
                allTags={allTags}
                existingCategories={existingCategories}
                systemGenres={system.genres || []}
                isEditor={isEditor}
                onOpenBook={openBook}
                onSaveBook={saveBook}
                bulkMode={bulkMode}
                selectedBookIds={selectedBookIds}
                onToggleBook={toggleBookSelect}
              />
            ))}
          </div>
        )}

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
          existingCategories={existingCategories}
          systemGenres={system.genres || []}
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
