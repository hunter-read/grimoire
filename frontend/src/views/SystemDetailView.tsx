import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ComponentType,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useSessionState from '../hooks/useSessionState'
import useCollapsedSet from '../hooks/useCollapsedSet'
import useSystemSearch from '../hooks/useSystemSearch'
import useRestoredView from '../hooks/useRestoredView'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuPencil, LuFolderOpen, LuSearch, LuX, LuDownload } from 'react-icons/lu'
import api, { bulk as bulkApi, type Schema } from '../api'
import DownloadArchiveModal from '../components/DownloadArchiveModal'
import BulkActionBar from '../components/BulkActionBar'
import useBulkMerge from '../hooks/useBulkMerge'
import AddToCampaignModal from '../components/AddToCampaignModal'
import BulkEditModalJs from '../components/BulkEditModal'
import useBulkSelection from '../hooks/useBulkSelection'

import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import TagJs from '../components/Tag'
import SystemEditor from '../components/system/SystemEditor'
import SystemLinks from '../components/system/SystemLinks'
import SystemDescription from '../components/system/SystemDescription'
import SystemSearchResults from '../components/system/SystemSearchResults'
import SystemCategorySection from '../components/system/SystemCategorySection'
import SystemContainerView from '../components/system/SystemContainerView'
import CategoryBookItem from '../components/system/CategoryBookItem'
import CategoryGroupToggle from '../components/system/CategoryGroupToggle'
import { nodeKey, orderedNodeEntries } from '../components/system/shelfTree'
import LoadMoreSentinel from '../components/LoadMoreSentinel'
import useShelf from '../hooks/useShelf'
import { bookFilterParams, withQuery } from '../utils/browseParams'
import { getFolderPlacement } from '../hooks/useUserPrefs'
import BulkToggleButtonJs from '../components/BulkToggleButton'
import CollapseExpandButtons from '../components/CollapseExpandButtons'
import ToolbarButtonJs from '../components/ToolbarButton'
import RescanButtonJs from '../components/RescanButton'
import FavoriteButtonJs from '../components/FavoriteButton'
import ViewModeToggle from '../components/ViewModeToggle'
import useViewMode from '../hooks/useViewMode'
import SortFilterBarJs from '../components/library/SortFilterBar'
import useSavedFilters from '../hooks/useSavedFilters'
import { CATEGORY_ORDER } from '../constants'
import { defaultCollapsedFromCounts } from '../utils/autoCollapse'
import { systemDisplayName } from '../utils/systemDisplayName'
import { parentSystemLabel } from '../utils/parentSystemLabel'
import useTagLabels, { titleCaseTag } from '../hooks/useTagLabels'
import { RECENTLY_ADDED_DAYS } from '../utils/recentlyAdded'

// Still-JavaScript components whose props TypeScript would infer from their
// defaults, turning every optional prop into a required one.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = ComponentType<Record<string, any>>
const Tag = TagJs as Loose
const BulkToggleButton = BulkToggleButtonJs as Loose
const ToolbarButton = ToolbarButtonJs as Loose
const FavoriteButton = FavoriteButtonJs as Loose
const SortFilterBar = SortFilterBarJs as Loose
const RescanButton = RescanButtonJs as Loose
const BulkEditModal = BulkEditModalJs as Loose

type System = Schema<'SystemDetail'>
type Book = Schema<'BookOut'>

interface BookFilter {
  sort: string
  order: string
  filters: { tags?: unknown; favorites?: boolean; [key: string]: unknown }
}

/** A category or subfolder of the shelf, as shelfTree's buildShelf builds it. */
interface ShelfNode {
  category: string
  path: string
  count: number
  direct: number
  folders: Record<string, ShelfNode>
}

/** What useShelf (still JavaScript) returns. */
interface ShelfData {
  system: System | null
  setSystem: Dispatch<SetStateAction<System | null>>
  facets: {
    categories: string[]
    genres: string[]
    product_code_prefixes: string[]
    tags: string[]
  }
  shelf: Record<string, ShelfNode>
  pages: { get: (key: string) => { items: Book[]; hasMore: boolean } | undefined }
  loadNode: (...args: unknown[]) => void
  loadedBooks: Book[]
  updateBooks: (fn: (book: Book) => Book) => void
  reload: () => void
  flatBooks: Book[]
  flatHasMore: boolean
  flatLoading: boolean
  loadMoreFlat: () => void
  matchCount: number
}

type SetState<T> = Dispatch<SetStateAction<T>>

const DEFAULT_BOOK_FILTER: BookFilter = { sort: 'title', order: 'asc', filters: {} }

const foldersToTags = (r: unknown) => {
  const map: Record<string, string[]> = {}
  for (const f of (r as { folders?: { path: string; tags?: string[] }[] })?.folders || [])
    map[f.path] = f.tags || []
  return map
}

export default function SystemDetailView() {
  const { t } = useTranslation()
  const { systemId } = useParams()
  const navigate = useNavigate()
  const user = useAuth()?.user
  const isEditor = user?.role === 'admin' || user?.role === 'gm'
  // Returning from the reader restores the search/sort/filter you left behind;
  // navigating here fresh always starts clean.
  const restoreView = useRestoredView()
  const [editing, setEditing] = useState(false)
  const [editingBookId, setEditingBookId] = useState<string | null>(null)
  // Book subcategory folder tags, keyed by BookFolder path
  // ("{systemId}/{category}/{subfolder…}"). Loaded once per system; edited
  // inline on each folder group header (issue #235 follow-up).
  const [bookFolderTags, setBookFolderTags] = useState<Record<string, string[]>>({})
  const [editingFolderKey, setEditingFolderKey] = useState<string | null>(null)
  const [collapsedSubfolders, setCollapsedSubfolders] = useSessionState(
    `grimoire:system:${systemId}:subfolders`,
    new Set()
  ) as [Set<string>, SetState<Set<string>>]
  // Whether books are split into category sections (default) or shown as one
  // flat sorted list. Persisted per system for the session. Sort/filter state
  // is independent of this toggle.
  const [grouped, setGrouped] = useSessionState(`grimoire:system:${systemId}:grouped`, true) as [
    boolean,
    SetState<boolean>,
  ]
  // Books sort/filter now flow through the shared SortFilterBar state, with
  // server-backed saved presets (scope "books"). Favourites/tags/explicit/genre
  // all live in filters; the category grouping below is preserved.
  // Persisted only for a return trip from the reader (issue: a search/filter set
  // before opening a book should still be there on back, but a fresh visit to the
  // system starts from the user's default preset).
  const [bookFilter, setBookFilter] = useSessionState(
    `grimoire:system:${systemId}:book-filter`,
    DEFAULT_BOOK_FILTER,
    { restore: restoreView }
  ) as [BookFilter, SetState<BookFilter>]
  const [defaultApplied, setDefaultApplied] = useState(restoreView)

  // The summary, filter options, category/subfolder tree and the books
  // themselves all come from the server, the books a page at a time
  // (issue #221) - a system can hold tens of thousands of them.
  const shelfData = useShelf(systemId, {
    grouped,
    bookFilter,
    ready: defaultApplied,
  }) as unknown as ShelfData
  const { system, setSystem, facets, shelf, pages, loadNode, loadedBooks, updateBooks } = shelfData

  // A long system starts with its categories collapsed (a small core stays
  // open) until the user opens or closes one; see autoCollapse.js. Counted on
  // the matching books, so narrowing the list opens the categories it leaves.
  const categoryCounts = useMemo(
    () => Object.fromEntries(Object.entries(shelf).map(([cat, node]) => [cat, node.count])),
    [shelf]
  )
  const [collapsedCats, setCollapsedCats] = useCollapsedSet(
    `grimoire:system:${systemId}:collapsed`,
    defaultCollapsedFromCounts(categoryCounts)
  ) as [Set<string>, SetState<Set<string>>]
  // Two independent view modes: the book list below uses the "book" preference,
  // while a container system's child-system grid uses the "system" one — the same
  // setting the main library grid uses (issue #296). Sharing one mode made
  // changing the system layout silently restyle every book list.
  const [viewMode, cycleViewMode] = useViewMode('book')
  const [systemViewMode, cycleSystemViewMode] = useViewMode('system')
  const { searchQuery, searchResults, searching, handleSearchInput, clearSearch } = useSystemSearch(
    systemId,
    restoreView
  ) as {
    searchQuery: string
    searchResults: { query?: string } | null
    searching: boolean
    handleSearchInput: (e: React.ChangeEvent<HTMLInputElement>) => void
    clearSearch: () => void
  }
  const [downloadModal, setDownloadModal] = useState<{
    title: string
    params: Record<string, unknown>
  } | null>(null)
  // Books whose title or metadata match the in-system search, shown above the
  // page hits. Asked of the server with the shelf's filters, so they honour the
  // same tag/favourite filters as the grid.
  const [matchedBooks, setMatchedBooks] = useState<Book[]>([])

  // Bulk multiselect (books only)
  const bulk = useBulkSelection()
  const { bulkMode, selectedIds: selectedBookIds, count: totalSelected } = bulk
  const [bulkApplying, setBulkApplying] = useState(false)
  const [showAddToCampaign, setShowAddToCampaign] = useState(false)
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  // Shared-tag display labels for book tags (filter values match on internal key).
  const bookTagLabels = useTagLabels('book') as Record<string, string>

  // Load book subcategory folder tags for this system.
  useEffect(() => {
    api
      .get(`/systems/${systemId}/book-folders`)
      .then((r) => setBookFolderTags(foldersToTags(r)))
      .catch(() => setBookFolderTags({}))
  }, [systemId])

  useEffect(() => {
    if (!searchResults?.query) {
      setMatchedBooks([])
      return undefined
    }
    let cancelled = false
    const params = {
      ...bookFilterParams(bookFilter.filters || {}),
      q: searchResults.query,
      limit: 50,
    }
    api
      .get(withQuery(`/systems/${systemId}/books`, params))
      .then((r) => !cancelled && setMatchedBooks((r as { books?: Book[] })?.books || []))
      .catch(() => !cancelled && setMatchedBooks([]))
    return () => {
      cancelled = true
    }
  }, [searchResults, systemId, bookFilter.filters])

  const {
    saved: savedBookFilters,
    loaded: bookFiltersLoaded,
    defaultFilter: defaultBookFilter,
    save: saveBookPreset,
    setDefault: setBookPresetDefault,
    remove: removeBookPreset,
  } = useSavedFilters('books') as {
    saved: unknown[]
    loaded: boolean
    defaultFilter: { state?: BookFilter } | null
    save: (name: string, state: BookFilter, opts?: unknown) => void
    setDefault: (...args: unknown[]) => void
    remove: (...args: unknown[]) => void
  }

  // Apply the user's default books preset once on load.
  useEffect(() => {
    if (bookFiltersLoaded && !defaultApplied) {
      if (defaultBookFilter?.state) setBookFilter(defaultBookFilter.state)
      setDefaultApplied(true)
    }
    // `setBookFilter` is a useSessionState setter, rebuilt every render; the
    // defaultApplied guard already makes this run exactly once.
  }, [bookFiltersLoaded, defaultApplied, defaultBookFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // A variant link changed. Reload, then follow the promotion: the newly
  // promoted copy is the row that exists now, so the editor re-opens on it
  // rather than on an id that has just become a hidden variant. It may sit in a
  // different category than the book it replaced, which is exactly why this
  // cannot be a local patch.
  const { reload } = shelfData
  const handleVariantsChanged = useCallback(
    (newMainId?: string) => {
      reload()
      if (newMainId) setEditingBookId(newMainId)
    },
    [reload]
  )

  // Merge (issue #589). A merge can fold a book into one in another category,
  // so the shelf is reloaded rather than patched.
  const merge = useBulkMerge(
    [...selectedBookIds].map((id) => ({ type: 'book', id: id as string })),
    () => {
      bulk.clear()
      reload()
    }
  )

  if (!system)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  // A system nested in a container (issues #261, #262) was reached *through* that
  // container, so going "back" returns there rather than skipping to the library
  // root. The same holds for a container nested in another container (issue #498).
  // Container names may be raw folder slugs, hence the prettified label.
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

  // Container folders hold systems, not categories (issues #261, #262), so they
  // render their children as a system grid instead of a book list. A container
  // with no children yet falls through to the normal view rather than showing an
  // empty grid — that way a half-scanned library still shows whatever it found.
  // The agnostic collection carries a container kind but is not a shelf of
  // systems — its subfolders are categories — so it falls through to the normal
  // book view below (issue: marking a folder .system-agnostic-container turned
  // its categories into systems and emptied the collection page).
  if (system.container_kind && !system.is_system_agnostic && (system.children || []).length > 0) {
    return (
      <SystemContainerView
        system={system}
        viewMode={systemViewMode}
        onCycleViewMode={cycleSystemViewMode}
        canEdit={isEditor}
        backLabel={backTarget.label}
        onBack={() => navigate(backTarget.to, { state: { restoreView: true } })}
        onCoverChange={(cover: Partial<System>) => setSystem((s) => (s ? { ...s, ...cover } : s))}
        onChildrenChange={(update: (children: System['children']) => System['children']) =>
          setSystem((s) => (s ? { ...s, children: update(s.children) } : s))
        }
      />
    )
  }

  // Special collections (system-agnostic + one-page/small RPGs) are not real
  // game systems, so they don't expose editable system metadata.
  const isSpecialCollection = system.is_system_agnostic || system.is_one_page
  const canEditSystemMeta = isEditor && !isSpecialCollection

  // Every tag, category, genre and product code on the shelf - for the editors'
  // suggestions and the filter menus - from the server, since only some of the
  // books are ever loaded.
  const allTags = facets.tags
  const existingCategories = facets.categories

  const bookFilters = bookFilter.filters || {}
  // For the empty-state copy.
  const favOnly = bookFilters.favorites === true

  const updateBookFilter = (next: BookFilter) => setBookFilter(next)
  const handleSaveBookPreset = (name: string, opts?: unknown) =>
    saveBookPreset(name, bookFilter, opts)

  // How folders are ordered against the books beside them: the active sort plus
  // the user's folder-placement preference (issue #448).
  const folderOrder = {
    sort: bookFilter.sort,
    order: bookFilter.order,
    placement: getFolderPlacement(),
  }

  const allCatKeys = Object.keys(shelf)
  const collapseAll = () => setCollapsedCats(new Set(allCatKeys))
  const expandAll = () => setCollapsedCats(new Set())

  // Category render order (built-ins first, then any custom categories).
  const orderedCatKeys = [
    ...CATEGORY_ORDER,
    ...allCatKeys.filter((c) => !CATEGORY_ORDER.includes(c)).sort(),
  ].filter((cat) => shelf[cat])

  // Loaded books in on-screen order, for shift-range selection: grouped → by
  // category, walking each node as it is drawn; flat → the single sorted list.
  // Only books that have loaded can fall inside a range.
  const nodeBooks = (node: ShelfNode): Book[] => {
    const list = pages.get(nodeKey(node.category, node.path))
    const books = list ? list.items : []
    const hasMore = node.direct > 0 && (!list || list.hasMore)
    const entries = orderedNodeEntries(node, books, { ...folderOrder, hasMore }) as {
      type: string
      book?: Book
      node?: ShelfNode
    }[]
    return entries.flatMap((entry) =>
      entry.type === 'book' ? [entry.book as Book] : nodeBooks(entry.node as ShelfNode)
    )
  }
  const orderedBookIds = grouped
    ? orderedCatKeys.flatMap((cat) => nodeBooks(shelf[cat]).map((b) => b.id))
    : shelfData.flatBooks.map((b) => b.id)
  const toggleBookSelect = (id: string, mods: { shift?: boolean; meta?: boolean } = {}) =>
    bulk.toggleItem(id, { ...mods, orderedIds: orderedBookIds })

  const selectedBookObjects = () => loadedBooks.filter((b) => selectedBookIds.has(b.id))

  // One request for the whole selection: the old per-book PATCH fan-out raced on
  // tag creation server-side and returned intermittent 500s (issue #270).
  const applyBulkTags = async (newTags: string[]) => {
    if (!newTags.length || totalSelected === 0 || bulkApplying) return
    setBulkApplying(true)
    try {
      const ids = [...selectedBookIds]
      if (!ids.length) return
      const { tags } = await bulkApi.addTags('book', ids, newTags)
      updateBooks((b) => (tags?.[b.id] ? { ...b, tags: tags[b.id] } : b))
      // Selection is deliberately kept so tags can be applied one at a time to
      // the same batch (issue #256).
    } finally {
      setBulkApplying(false)
    }
  }

  // An edit can move a book to another category or reorder it; the shelf is
  // grouped and sorted by the server, so those are reloaded rather than patched.
  const movesBook = (before: Book | undefined, after: Partial<Book>) =>
    !!before &&
    Object.keys(after).some(
      (k) =>
        ['category', 'title', 'year', 'page_count', 'product_code'].includes(k) &&
        after[k as keyof Book] !== before[k as keyof Book]
    )

  const applyBookEdits = (edited: Record<string, Partial<Book>>) => {
    const moved = loadedBooks.some((b) => edited[b.id] && movesBook(b, edited[b.id]))
    if (moved) reload()
    else updateBooks((b) => (edited[b.id] ? { ...b, ...edited[b.id] } : b))
  }

  // Shared handlers passed down to the category sections.
  const saveBook = (bookId: string, updated: Partial<Book>) => applyBookEdits({ [bookId]: updated })

  // Persist a book folder's tags and reflect them locally. ``path`` is the full
  // BookFolder path ("{systemId}/{category}/{subfolder…}").
  const saveBookFolderTags = (path: string, tags: string[]) => {
    setBookFolderTags((prev) => ({ ...prev, [path]: tags }))
    setEditingFolderKey(null)
    api
      .patch(`/systems/${systemId}/book-folders`, { path, tags })
      .catch(() =>
        api
          .get(`/systems/${systemId}/book-folders`)
          .then((r) => setBookFolderTags(foldersToTags(r)))
      )
  }

  const toggleSubfolder = (key: string) =>
    setCollapsedSubfolders((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // Sort + filter options for the books SortFilterBar.
  const bookSortOptions = [
    { value: 'title', label: t('sortFilter.sortTitle') },
    { value: 'year', label: t('sortFilter.sortYear') },
    { value: 'page_count', label: t('sortFilter.sortPageCount') },
    { value: 'size', label: t('sortFilter.sortSize') },
    { value: 'product_code', label: t('sortFilter.sortProductCode') },
    { value: 'added_at', label: t('sortFilter.sortAddedAt'), defaultOrder: 'desc' },
  ]
  const bookGenreOptions = facets.genres.map((g) => ({ value: g, label: g }))
  // Product codes are unique per book, so the filter offers their publisher
  // prefixes ("PZO", "TSR") plus the has/has-no-code sentinels (issue #479).
  const bookProductCodeOptions = facets.product_code_prefixes.map((p) => ({
    value: p,
    label: `${p}…`,
  }))
  const bookTagOptions = [...new Set(allTags.map((tg) => tg.toLowerCase()))].map((tg) => ({
    value: tg,
    label: bookTagLabels[tg] || titleCaseTag(tg),
  }))

  // Book view mode → layout flags shared with BookRow / BookFolderGroup.
  const card = viewMode === 'card'
  const compact = viewMode === 'compact'
  const list = viewMode === 'list'

  // Container for a list of books in the current view mode.
  const booksContainerStyle: CSSProperties = list
    ? { display: 'flex', flexDirection: 'column', gap: 8 }
    : {
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? '140px' : '200px'}, 1fr))`,
        gap: compact ? 12 : 16,
      }

  // Nothing matches the filters (or the shelf is empty).
  const noBooks = shelfData.matchCount === 0

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
            onClick={() => navigate(backTarget.to, { state: { restoreView: true } })}
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
                  {system.publishers.map((p, i: number) => (
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
              {system.description && <SystemDescription text={system.description} />}
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
              <SystemLinks system={system} />
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
                    scope={system.scope_path || null}
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
            onSave={(updated: Partial<System>) => {
              setSystem({ ...system, ...updated })
              setEditing(false)
            }}
            // Cover uploads apply immediately, so reflect them without closing
            // the editor or discarding unsaved metadata edits.
            onCoverChange={(cover: Partial<System>) =>
              setSystem((s) => (s ? { ...s, ...cover } : s))
            }
            // Linking or unlinking Grimoire Codex DB is saved at once, like a cover.
            onCodexLinkChange={(codexId: string | null) =>
              setSystem((s) => (s ? { ...s, codex_id: codexId } : s))
            }
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
            selectFilters={[
              {
                key: 'genres',
                label: t('sortFilter.filterGenre'),
                allLabel: t('sortFilter.allGenres'),
                options: bookGenreOptions,
              },
              {
                key: 'productCode',
                label: t('sortFilter.filterProductCode'),
                allLabel: t('sortFilter.allProductCodes'),
                options: bookProductCodeOptions,
              },
            ]}
            queryFilters={[
              {
                key: 'tags',
                label: t('sortFilter.filterTags'),
                emptyLabel: t('sortFilter.noTags'),
                options: bookTagOptions,
              },
            ]}
            toggleFilters={[
              { key: 'favorites', label: t('sortFilter.filterFavorites'), boolean: true },
              {
                key: 'recent',
                label: t('sortFilter.filterRecent', { days: RECENTLY_ADDED_DAYS }),
                boolean: true,
              },
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
        />

        {/* Books, grouped by category (default) or as one flat sorted list. */}
        {!searchResults &&
          grouped &&
          orderedCatKeys.map((cat) => (
            <SystemCategorySection
              key={cat}
              cat={cat}
              node={shelf[cat]}
              pages={pages}
              onLoadNode={loadNode}
              folderOrder={folderOrder}
              system={system}
              isCollapsed={collapsedCats.has(cat)}
              onToggleCat={() =>
                setCollapsedCats((prev) => {
                  const next = new Set(prev)
                  if (next.has(cat)) next.delete(cat)
                  else next.add(cat)
                  return next
                })
              }
              collapsedSubfolders={collapsedSubfolders}
              onToggleSubfolder={toggleSubfolder}
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
              onSaveBook={saveBook}
              onVariantsChanged={handleVariantsChanged}
              onDownload={setDownloadModal}
              bulkMode={bulkMode}
              selectedBookIds={selectedBookIds}
              onToggleBook={toggleBookSelect}
            />
          ))}

        {!searchResults && !grouped && shelfData.flatBooks.length > 0 && (
          <div style={booksContainerStyle}>
            {shelfData.flatBooks.map((book) => (
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
                onSaveBook={saveBook}
                onVariantsChanged={handleVariantsChanged}
                bulkMode={bulkMode}
                selectedBookIds={selectedBookIds}
                onToggleBook={toggleBookSelect}
              />
            ))}
          </div>
        )}

        {/* The flat list pages in as its end scrolls near (issue #221). */}
        {!searchResults && !grouped && (
          <>
            {shelfData.flatLoading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
                <Spinner size={20} />
              </div>
            )}
            <LoadMoreSentinel
              active={shelfData.flatHasMore && !shelfData.flatLoading}
              count={shelfData.flatBooks.length}
              onVisible={shelfData.loadMoreFlat}
            />
          </>
        )}

        {!searchResults && noBooks && (
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
          {...merge.barProps}
          onDone={bulk.exit}
        />
      )}
      {merge.dialog}

      {showAddToCampaign && (
        <AddToCampaignModal
          items={selectedBookObjects().map((b) => ({ resource_type: 'book', resource_id: b.id }))}
          onClose={() => setShowAddToCampaign(false)}
          onAdded={() => setShowAddToCampaign(false)}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          type="book"
          items={selectedBookObjects()}
          existingCategories={existingCategories}
          systemGenres={system.genres || []}
          onClose={() => setShowBulkEdit(false)}
          onSaved={(edited: Record<string, Partial<Book>>) => {
            applyBookEdits(edited)
            setShowBulkEdit(false)
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
