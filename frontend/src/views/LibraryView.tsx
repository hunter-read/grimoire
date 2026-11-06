import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuLibrary, LuChevronDown, LuChevronRight } from 'react-icons/lu'
import api, { mediaUrl, type Schema } from '../api'
import Spinner from '../components/Spinner'
import LoadError from '../components/LoadError'
import useViewMode from '../hooks/useViewMode'
import { getUserPrefs, saveUserPref } from '../hooks/useUserPrefs'
import { getRecentBooks, getBookPrefs, removeRecentBook } from '../hooks/useBookPrefs'
import { useFavorites } from '../context/FavoritesContext'
import { useAuth } from '../context/AuthContext'
import useSystemLibrary from '../hooks/useSystemLibrary'
import usePageTitle from '../hooks/usePageTitle'
import useSavedFilters from '../hooks/useSavedFilters'
import useUrlSortFilterState from '../hooks/useUrlSortFilterState'
import useSlashToSearch from '../hooks/useSlashToSearch'
import usePins from '../hooks/usePins'
import SystemCard from '../components/library/SystemCard'
import SystemGroupToggle from '../components/library/SystemGroupToggle'
import AgnosticChip from '../components/library/AgnosticChip'
import SystemSortFilterBar from '../components/library/SystemSortFilterBar'
import type { SortFilterState } from '../components/library/FilterModal'
import SearchInput from '../components/library/SearchInput'
import IndexedLayout from '../components/thumbIndex/IndexedLayout'
import PinnedStrip from '../components/pins/PinnedStrip'
import { DEFAULT_SORT_FILTER } from '../hooks/useSortFilterState'
import { decadeKey, indexLetter } from '../utils/thumbIndex'
import { applySystemSortFilter } from '../components/library/applySystemSortFilter'
import { queryTags } from '../components/library/tagQuery'
import BulkActionBar from '../components/BulkActionBar'
import BulkEditModal from '../components/BulkEditModal'
import LazyImg from '../components/LazyImg'
import { libraryBase, type GameType } from '../utils/armory'

type SystemSummary = Schema<'SystemSummary'>

/** The modifier keys a card's selection click carries. */
interface SelectMods {
  shift?: boolean
  meta?: boolean
}

export interface LibraryViewProps {
  /**
   * Which shelves to show: the role-playing library (`books/`) or the Armory,
   * the wargame books in `armory/`. The two are the same view over a different
   * game type.
   */
  gameType?: GameType
}

export default function LibraryView({ gameType = 'ttrpg' }: LibraryViewProps) {
  const { t, i18n } = useTranslation()
  const isArmory = gameType === 'wargame'
  // Copy keys: the Armory has its own title, subtitle and search wording.
  const copy = isArmory ? 'armory' : 'library'
  const base = libraryBase(gameType)
  const { isFavorite } = useFavorites()
  const { user } = useAuth()!
  const canEdit = user?.role === 'admin' || user?.role === 'gm'
  const [systems, setSystems] = useState<SystemSummary[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [viewMode, cycleViewMode] = useViewMode('system')
  const [recentBooks, setRecentBooks] = useState(() => getRecentBooks())
  const [recentCollapsed, setRecentCollapsed] = useState(
    () => getUserPrefs().recentCollapsed === true
  )
  // Whether container folders show as single cards (default) or are flattened
  // into their child systems. A lasting browsing preference, so it persists
  // across reloads rather than only for the session.
  const [grouped, setGrouped] = useState(() => getUserPrefs().systemsGrouped !== false)
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const library = useSystemLibrary(systems, setSystems)
  const { bulk, allTags } = library
  const systemFilters = useSavedFilters('systems')
  // Session-persisted, so coming back from a system keeps the user's filters
  // instead of re-applying their saved default over them - and mirrored in the
  // address, so a filtered library can be bookmarked or shared.
  const [sortFilter, setSortFilter] = useUrlSortFilterState<SortFilterState>(
    isArmory ? 'grimoire:armory:sortFilter' : 'grimoire:systems:sortFilter',
    systemFilters,
    DEFAULT_SORT_FILTER
  )
  const searchRef = useRef<HTMLInputElement>(null)
  useSlashToSearch(searchRef)
  const pins = usePins('systems')

  usePageTitle(t(isArmory ? 'nav.armory' : 'nav.library'))

  // Children are fetched up front so the group toggle can flatten containers
  // without a second round trip; the grouped view filters them back out.
  useEffect(() => {
    let current = true
    setLoadFailed(false)
    api
      .get(`/systems?include_children=true&game_type=${gameType}`)
      .then((list) => {
        if (current) setSystems(list)
      })
      .catch(() => {
        if (current) setLoadFailed(true)
      })
    return () => {
      current = false
    }
  }, [attempt, gameType])

  if (!systems && loadFailed) return <LoadError onRetry={() => setAttempt((n) => n + 1)} />

  if (!systems)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  // Favorites and tags now live in the SortFilterBar filter section.
  const activeFilters = sortFilter.filters || {}
  // Tags currently filtering the grid (set via the Filters modal's Tags
  // dropdown). Presence sentinels aren't tags, so they stay out of this set.
  const selectedTags = new Set(queryTags(activeFilters.tags).map((tg) => tg.toLowerCase()))
  const favOnly = activeFilters.favorites === true
  const isFavSystem = (id: string) => isFavorite('system', id)

  // A container folder holds systems rather than books of its own, so it stays
  // visible on the strength of its children (issues #261, #262).
  const visible = (s: SystemSummary) => s.book_count > 0 || (s.container_kind && s.child_count > 0)

  // "Special" collections (system-agnostic + one-page/small RPGs) are grouped
  // together above the regular game systems and shown as compact chips.
  // Container folders ("Dungeons & Dragons" holding its editions, "d20 System"
  // holding its family members) are ordinary library entries in the main grid.
  const isSpecial = (s: SystemSummary) => s.is_system_agnostic || s.is_one_page

  // One-page collections are the exception to flattening. Their whole purpose
  // is to keep a pile of tiny one-book games out of the main grid, so spilling
  // dozens of them into it is exactly what the collection exists to prevent —
  // the container keeps its chip in the Special Collections strip and its
  // children stay reachable by drilling in, grouped or not.
  const isOnePageChild = (s: SystemSummary) => s.parent_id && s.parent_is_one_page

  // Grouped (default): containers show as one card and their children are
  // reached by drilling in, so the children stay out of the grid. Flattened:
  // the containers themselves drop out and their children take their place, so
  // the grid is a plain list of real systems (never both, which would show the
  // same games twice). Special collections keep their own chip strip either way.
  const inGrid = (s: SystemSummary) =>
    visible(s) &&
    !isSpecial(s) &&
    !isOnePageChild(s) &&
    (grouped ? !s.parent_id : !s.container_kind)

  // Every regular system this user can see, before the sort/filter bar narrows
  // it. The subtitle's denominator, so it only ever counts systems already
  // scoped to the user by /systems.
  const gridSystems = systems.filter(inGrid)

  // The bar filters (genre/family/explicit/favorites/tags), then sorts.
  const normalSystems = applySystemSortFilter(gridSystems, sortFilter, {
    isFavorite: isFavSystem,
  })

  // Bulk tagging and bulk edit are undefined for a container (it holds systems,
  // not books of its own), so it never takes part in a selection — including as
  // a member of a shift-click range. One-page containers live in the special
  // strip, so in practice this covers parent/family/publisher shelves.
  const selectableSystems = normalSystems.filter((s) => !s.container_kind)

  // The toggle only means something once a container exists to flatten, so a
  // library of plain systems doesn't carry a control that changes nothing.
  const hasContainers = systems.some((s) => s.container_kind && !isSpecial(s) && s.child_count > 0)

  // Special collections keep a simple A–Z ordering.
  const specialSystems = systems
    .filter((s) => visible(s) && isSpecial(s))
    .sort((a, b) => a.name.localeCompare(b.name))

  const tagFiltered = selectedTags.size > 0
  // Whether the library holds any browsable regular (non-special) systems at
  // all, ignoring the favorites/tag filters — drives the "Game Systems" section
  // (its toolbar, tag filter, and empty states). Special-only libraries skip it
  // and rely on the special-collection chips section above.
  const hasNormalSystems = systems.some(inGrid)
  // Whether the library is completely empty (no browsable systems of any kind).
  // Container children count here even while grouped: a library holding only a
  // container is not empty, it just needs drilling into.
  const isEmptyLibrary = !systems.some(visible)

  const sortKey = sortFilter.sort || 'name'

  const compact = viewMode === 'compact'
  const list = viewMode === 'list'
  const minCard = compact ? '130px' : '220px'

  return (
    <div
      className="fade-in"
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
    >
      <div
        style={{
          padding: 'clamp(20px, 4vw, 32px) clamp(16px, 4vw, 40px)',
          maxWidth: 1400,
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
          flex: 1,
        }}
      >
        {/* The page's own heading. Each section below carries an h2 and none of
            them reads as the page title, so this one is for screen readers. */}
        <h1 className="sr-only">{t('nav.library')}</h1>

        <PinnedStrip
          label={t('pins.systemsLabel')}
          links={pins.pins.flatMap((pin) => {
            const system = systems.find((s) => s.id === pin.target)
            return system ? [{ pin, label: system.name, to: `${base}/system/${system.id}` }] : []
          })}
          onUnpin={(pin) => void pins.toggle(pin.target)}
        />

        {/* Recently Opened */}
        {!isArmory && recentBooks.length > 0 && (
          <section aria-labelledby="recently-opened-heading" style={{ marginBottom: 40 }}>
            {/* A heading wrapping the toggle, so the section is reachable by
                heading navigation and still collapses from the same control. */}
            <h2
              id="recently-opened-heading"
              style={{ margin: 0, font: 'inherit', color: 'inherit', letterSpacing: 'normal' }}
            >
              <button
                onClick={() => {
                  const next = !recentCollapsed
                  setRecentCollapsed(next)
                  saveUserPref('recentCollapsed', next)
                }}
                aria-expanded={!recentCollapsed}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  marginBottom: recentCollapsed ? 0 : 12,
                  cursor: 'pointer',
                  fontSize: 16,
                  color: 'var(--text-dim)',
                  fontWeight: 500,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                {recentCollapsed ? <LuChevronRight size={16} /> : <LuChevronDown size={16} />}
                {t('library.recentlyOpened')}
              </button>
            </h2>
            <ul
              role="list"
              className="card-list"
              style={{
                display: recentCollapsed ? 'none' : 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              {recentBooks.map((book) => {
                const lastPage = getBookPrefs(book.id).page || 1
                const progress =
                  (book.page_count ?? 0) > 0 ? Math.min(lastPage / book.page_count!, 1) : 0
                const total = (book.page_count ?? 0) > 0 ? book.page_count : '?'
                return (
                  // A real link rather than a click handler on a div, so it is
                  // reached with Tab and announced as a link. The remove button
                  // sits beside it, since a button cannot live inside a link.
                  <li key={book.id} style={{ position: 'relative', maxWidth: 260 }}>
                    <Link
                      to={`/library/book/${book.id}?page=${lastPage}`}
                      state={{ from: '/library' }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = 'var(--bg-card-hover)')
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        height: '100%',
                        boxSizing: 'border-box',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '8px 24px 8px 12px',
                        color: 'var(--text)',
                        textDecoration: 'none',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      {progress > 0 && (
                        <div
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: 2,
                            background: 'var(--bg-deep)',
                          }}
                        >
                          <div
                            style={{
                              width: `${progress * 100}%`,
                              height: '100%',
                              background: 'var(--gold-dim)',
                            }}
                          />
                        </div>
                      )}
                      <div
                        style={{
                          width: 28,
                          height: 36,
                          borderRadius: 3,
                          overflow: 'hidden',
                          flexShrink: 0,
                          background: 'var(--bg-deep)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {book.has_thumbnail ? (
                          <LazyImg
                            src={mediaUrl(`/books/${book.id}/thumbnail`)}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            style={{ fontSize: 14, color: 'var(--text-muted)' }}
                          >
                            📄
                          </span>
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: 170,
                          }}
                        >
                          {book.title}
                        </div>
                        {progress > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--gold-dim)', marginTop: 2 }}>
                            {/* "p. 12 / 300" is read aloud as "p twelve slash three
                                hundred"; a screen reader gets the words instead. */}
                            <span aria-hidden="true">
                              {t('common.pageRange', { page: lastPage, total })}
                            </span>
                            <span className="sr-only">
                              {t('a11y.readingProgress', { page: lastPage, total })}
                            </span>
                          </div>
                        )}
                      </div>
                    </Link>
                    <button
                      onClick={() => {
                        removeRecentBook(book.id)
                        setRecentBooks(getRecentBooks())
                      }}
                      title={t('library.removeFromRecent')}
                      aria-label={t('a11y.removeFromRecent', { title: book.title })}
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        fontSize: 12,
                        lineHeight: 1,
                        padding: '1px 3px',
                        borderRadius: 3,
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--text)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--text-muted)'
                      }}
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {/* Special collections (System-Agnostic + One-Page RPGs) — kept at the top
          for quick access, shown as compact chips rather than full image cards. */}
        {specialSystems.length > 0 && (
          <section aria-labelledby="special-collections-heading" style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <LuLibrary size={18} color="var(--gold-dim)" />
              <h2 id="special-collections-heading" style={{ fontSize: 22, margin: 0 }}>
                {t('library.agnosticTitle')}
              </h2>
            </div>
            <p
              style={{
                color: 'var(--text-dim)',
                fontSize: 15,
                fontFamily: 'Alegreya, serif',
                fontStyle: 'italic',
                marginBottom: 16,
              }}
            >
              {t('library.agnosticSubtitle')}
            </p>
            <ul
              role="list"
              className="card-list"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}
            >
              {specialSystems.map((system) => (
                <li key={system.id}>
                  <AgnosticChip system={system} to={`${base}/system/${system.id}`} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Game Systems */}
        {hasNormalSystems && (
          <>
            <div style={{ marginBottom: 24 }}>
              {/* The grouping toggle sits on the heading row, right-aligned: it
                  reshapes what the section *contains*, unlike the sort/filter
                  bar's controls which act on a fixed set of rows. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                <h2 style={{ fontSize: 28, margin: 0 }}>{t(`${copy}.title`)}</h2>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    flex: '0 1 420px',
                    justifyContent: 'flex-end',
                  }}
                >
                  <SearchInput
                    inputRef={searchRef}
                    shortcut="/"
                    value={(activeFilters.search as string | undefined) || ''}
                    onChange={(v) =>
                      setSortFilter((s) => ({
                        ...s,
                        filters: { ...s.filters, search: v || undefined },
                      }))
                    }
                    placeholder={t(`${copy}.searchPlaceholder`)}
                    style={{ flex: '1 1 220px' }}
                  />
                  {hasContainers && (
                    <SystemGroupToggle
                      grouped={grouped}
                      onToggle={(next: boolean) => {
                        setGrouped(next)
                        saveUserPref('systemsGrouped', next)
                      }}
                    />
                  )}
                </div>
              </div>
              {/* Live, so narrowing the grid with a filter or the search box
                  tells a screen reader how many systems are left. */}
              <p
                aria-live="polite"
                aria-atomic="true"
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 17,
                  fontFamily: 'Alegreya, serif',
                  fontStyle: 'italic',
                }}
              >
                {normalSystems.length === gridSystems.length
                  ? t(`${copy}.subtitle`, { count: normalSystems.length })
                  : t(`${copy}.subtitleFiltered`, {
                      count: normalSystems.length,
                      total: gridSystems.length,
                    })}
              </p>
            </div>

            <SystemSortFilterBar
              systems={gridSystems}
              tags={allTags}
              state={sortFilter}
              onChange={setSortFilter}
              saved={systemFilters}
              bulk={bulk}
              canEdit={canEdit}
              viewMode={viewMode}
              onCycleViewMode={cycleViewMode}
              showSearch={false}
            />

            {normalSystems.length > 0 ? (
              <IndexedLayout
                items={normalSystems}
                enabled={sortKey === 'name' || sortKey === 'year'}
                keyOf={(s) =>
                  sortKey === 'year' ? decadeKey(s.year) : indexLetter(s.name, i18n?.language)
                }
                nameOf={(s) => s.name}
                scope="systems"
                railLabel={t('thumbIndex.jumpSystems')}
                describe={(run) => t('thumbIndex.systems', { count: run.count })}
                formatLabel={(label) => (label === '#' && sortKey === 'year' ? '?' : label)}
                headingLevel={3}
                lazySections
                renderItems={(sectionSystems) => (
                  <ul
                    role="list"
                    className="card-list"
                    style={
                      list
                        ? { display: 'flex', flexDirection: 'column', gap: 8 }
                        : {
                            display: 'grid',
                            gridTemplateColumns: `repeat(auto-fill, minmax(${minCard}, 1fr))`,
                            gap: compact ? 12 : 20,
                          }
                    }
                  >
                    {sectionSystems.map((system) => (
                      <li key={system.id}>
                        <SystemCard
                          system={system}
                          to={`${base}/system/${system.id}`}
                          compact={compact}
                          list={list}
                          selectable={bulk.bulkMode}
                          selected={bulk.selectedIds.has(system.id)}
                          onToggleSelect={(mods: SelectMods) =>
                            bulk.toggleItem(system.id, {
                              ...mods,
                              // Parent containers are excluded from bulk actions, so
                              // they're left out of the range list too — a shift-drag
                              // across one must not sweep it into the selection.
                              orderedIds: selectableSystems.map((s) => s.id),
                            })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              />
            ) : tagFiltered ? (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 32 }}>
                {t('library.noTagMatch')}
              </p>
            ) : favOnly ? (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 32 }}>
                {t('favorites.noFavoritesInView')}
              </p>
            ) : null}
          </>
        )}

        {/* Empty state when the library has no browsable systems at all */}
        {isEmptyLibrary && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 28, marginBottom: 8 }}>{t(`${copy}.title`)}</h2>
            <p
              style={{
                color: 'var(--text-dim)',
                fontSize: 17,
                fontFamily: 'Alegreya, serif',
                fontStyle: 'italic',
              }}
            >
              {t(`${copy}.subtitle`, { count: 0 })}
            </p>
            {isArmory && (
              <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 640 }}>
                {t('armory.emptyHint')}
              </p>
            )}
          </div>
        )}
      </div>

      {bulk.bulkMode && (
        <BulkActionBar
          count={bulk.count}
          onApplyTags={library.applyTags}
          onBulkEdit={() => setShowBulkEdit(true)}
          onDone={bulk.exit}
          applying={library.applying}
        />
      )}

      {showBulkEdit && (
        <BulkEditModal
          type="system"
          items={library.selectedSystems}
          onClose={() => setShowBulkEdit(false)}
          onSaved={(edited) => {
            library.applyEdits(edited)
            setShowBulkEdit(false)
          }}
        />
      )}
    </div>
  )
}
