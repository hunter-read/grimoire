import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuLibrary, LuChevronDown, LuChevronRight } from 'react-icons/lu'
import api, { mediaUrl } from '../api'
import Spinner from '../components/Spinner'
import useViewMode from '../hooks/useViewMode'
import ViewModeToggle from '../components/ViewModeToggle'
import BulkToggleButton from '../components/BulkToggleButton'
import { getUserPrefs, saveUserPref } from '../hooks/useUserPrefs'
import { getRecentBooks, getBookPrefs, removeRecentBook } from '../hooks/useBookPrefs'
import { useFavorites } from '../context/FavoritesContext'
import { useAuth } from '../context/AuthContext'
import useSystemLibrary from '../hooks/useSystemLibrary'
import useSavedFilters from '../hooks/useSavedFilters'
import useSortFilterState from '../hooks/useSortFilterState'
import useTagLabels, { titleCaseTag } from '../hooks/useTagLabels'
import SystemCard from '../components/library/SystemCard'
import SystemGroupToggle from '../components/library/SystemGroupToggle'
import AgnosticChip from '../components/library/AgnosticChip'
import SortFilterBar from '../components/library/SortFilterBar'
import { applySystemSortFilter } from '../components/library/applySystemSortFilter'
import { isSpecialFilter } from '../components/library/specialFilters'
import BulkActionBar from '../components/BulkActionBar'
import BulkEditModal from '../components/BulkEditModal'
import LazyImg from '../components/LazyImg'

export default function LibraryView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isFavorite } = useFavorites()
  const { user } = useAuth()
  const canEdit = user?.role === 'admin' || user?.role === 'gm'
  const [systems, setSystems] = useState(null)
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
  // Shared-tag display labels for system tags (values still match on internal key).
  const systemTagLabels = useTagLabels('system')
  const systemFilters = useSavedFilters('systems')
  const {
    saved: savedFilters,
    save: savePreset,
    setDefault: setPresetDefault,
    remove: removePreset,
  } = systemFilters
  // Session-persisted, so coming back from a system keeps the user's filters
  // instead of re-applying their saved default over them.
  const [sortFilter, setSortFilter] = useSortFilterState(
    'grimoire:systems:sortFilter',
    systemFilters
  )

  // Children are fetched up front so the group toggle can flatten containers
  // without a second round trip; the grouped view filters them back out.
  useEffect(() => {
    api.get('/systems?include_children=true').then(setSystems)
  }, [])

  const updateSortFilter = (next) => {
    setSortFilter(next)
  }

  const handleSavePreset = (name, opts) => savePreset(name, sortFilter, opts)

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
  const selectedTags = new Set(
    (activeFilters.tags || []).filter((tg) => !isSpecialFilter(tg)).map((tg) => tg.toLowerCase())
  )
  const favOnly = activeFilters.favorites === true
  const isFavSystem = (id) => isFavorite('system', id)

  // A container folder holds systems rather than books of its own, so it stays
  // visible on the strength of its children (issues #261, #262).
  const visible = (s) => s.book_count > 0 || (s.container_kind && s.child_count > 0)

  // "Special" collections (system-agnostic + one-page/small RPGs) are grouped
  // together above the regular game systems and shown as compact chips.
  // Container folders ("Dungeons & Dragons" holding its editions, "d20 System"
  // holding its family members) are ordinary library entries in the main grid.
  const isSpecial = (s) => s.is_system_agnostic || s.is_one_page

  // One-page collections are the exception to flattening. Their whole purpose
  // is to keep a pile of tiny one-book games out of the main grid, so spilling
  // dozens of them into it is exactly what the collection exists to prevent —
  // the container keeps its chip in the Special Collections strip and its
  // children stay reachable by drilling in, grouped or not.
  const isOnePageChild = (s) => s.parent_id && s.parent_is_one_page

  // Grouped (default): containers show as one card and their children are
  // reached by drilling in, so the children stay out of the grid. Flattened:
  // the containers themselves drop out and their children take their place, so
  // the grid is a plain list of real systems (never both, which would show the
  // same games twice). Special collections keep their own chip strip either way.
  const inGrid = (s) =>
    visible(s) &&
    !isSpecial(s) &&
    !isOnePageChild(s) &&
    (grouped ? !s.parent_id : !s.container_kind)

  // The bar filters (genre/family/explicit/favorites/tags), then sorts.
  const normalSystems = applySystemSortFilter(systems.filter(inGrid), sortFilter, {
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

  // Filter dropdown options are derived from the rows actually in the grid, so
  // flattening a container surfaces its children's families/genres and grouping
  // hides them again — an option that can never match is worse than a missing
  // one. (Edition is deliberately not offered: it isn't recorded consistently
  // enough across systems to filter on.)
  const gridSystems = systems.filter(inGrid)
  const optionsFrom = (pick) =>
    [...new Set(gridSystems.flatMap((s) => [pick(s)].flat().filter(Boolean)))]
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }))

  const genreOptions = optionsFrom((s) => s.genres || [])
  const familyOptions = optionsFrom((s) => s.system_family)
  const parentSystemOptions = optionsFrom((s) => s.parent_system)
  const diceOptions = optionsFrom((s) => s.dice_materials || [])
  const tagOptions = allTags.map((tg) => ({
    value: tg,
    label: systemTagLabels[tg] || titleCaseTag(tg),
  }))

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
        {/* Recently Opened */}
        {recentBooks.length > 0 && (
          <div style={{ marginBottom: 40 }}>
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
            <div
              style={{
                display: recentCollapsed ? 'none' : 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              {recentBooks.map((book) => {
                const lastPage = getBookPrefs(book.id).page || 1
                const progress = book.page_count > 0 ? Math.min(lastPage / book.page_count, 1) : 0
                return (
                  <div
                    key={book.id}
                    onClick={() =>
                      navigate(`/library/book/${book.id}?page=${lastPage}`, {
                        state: { from: window.location.pathname },
                      })
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: '8px 12px',
                      cursor: 'pointer',
                      maxWidth: 260,
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'var(--bg-card-hover)')
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeRecentBook(book.id)
                        setRecentBooks(getRecentBooks())
                      }}
                      title={t('library.removeFromRecent')}
                      aria-label={t('library.removeFromRecent')}
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
                      ✕
                    </button>
                    {progress > 0 && (
                      <div
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
                        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>📄</span>
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
                          {t('common.pageRange', {
                            page: lastPage,
                            total: book.page_count > 0 ? book.page_count : '?',
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Special collections (System-Agnostic + One-Page RPGs) — kept at the top
          for quick access, shown as compact chips rather than full image cards. */}
        {specialSystems.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <LuLibrary size={18} color="var(--gold-dim)" />
              <h2 style={{ fontSize: 22, margin: 0 }}>{t('library.agnosticTitle')}</h2>
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {specialSystems.map((system) => (
                <AgnosticChip key={system.id} system={system} to={`/library/system/${system.id}`} />
              ))}
            </div>
          </div>
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
                <h2 style={{ fontSize: 28, margin: 0 }}>{t('library.title')}</h2>
                {hasContainers && (
                  <SystemGroupToggle
                    grouped={grouped}
                    onToggle={(next) => {
                      setGrouped(next)
                      saveUserPref('systemsGrouped', next)
                    }}
                  />
                )}
              </div>
              <p
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 17,
                  fontFamily: 'Alegreya, serif',
                  fontStyle: 'italic',
                }}
              >
                {t('library.subtitle', { count: normalSystems.length })}
              </p>
            </div>

            <SortFilterBar
              sticky
              scope="systems"
              trailing={
                <>
                  {canEdit && (
                    <BulkToggleButton
                      active={bulk.bulkMode}
                      onToggle={() => (bulk.bulkMode ? bulk.exit() : bulk.enter())}
                    />
                  )}
                  <ViewModeToggle mode={viewMode} onCycle={cycleViewMode} />
                </>
              }
              state={sortFilter}
              onChange={updateSortFilter}
              sortOptions={[
                { value: 'name', label: t('sortFilter.sortName') },
                { value: 'book_count', label: t('sortFilter.sortBookCount') },
                { value: 'page_count', label: t('sortFilter.sortPageCount') },
                { value: 'year', label: t('sortFilter.sortYear') },
              ]}
              selectFilters={[
                {
                  key: 'genre',
                  label: t('sortFilter.filterGenre'),
                  allLabel: t('sortFilter.allGenres'),
                  options: genreOptions,
                },
                {
                  key: 'family',
                  label: t('sortFilter.filterFamily'),
                  allLabel: t('sortFilter.allFamilies'),
                  options: familyOptions,
                },
                ...(parentSystemOptions.length
                  ? [
                      {
                        key: 'parent_system',
                        label: t('sortFilter.filterParentSystem'),
                        allLabel: t('sortFilter.allParentSystems'),
                        options: parentSystemOptions,
                      },
                    ]
                  : []),
              ]}
              multiFilters={[
                {
                  key: 'dice',
                  label: t('sortFilter.filterDice'),
                  emptyLabel: t('sortFilter.noDice'),
                  options: diceOptions,
                },
                {
                  key: 'tags',
                  label: t('sortFilter.filterTags'),
                  emptyLabel: t('sortFilter.noTags'),
                  options: tagOptions,
                },
              ]}
              toggleFilters={[
                {
                  key: 'favorites',
                  label: t('sortFilter.filterFavorites'),
                  boolean: true,
                },
                { key: 'explicit', label: t('sortFilter.filterExplicit') },
              ]}
              saved={savedFilters}
              onSavePreset={handleSavePreset}
              onSetDefault={setPresetDefault}
              onDeletePreset={removePreset}
            />

            {normalSystems.length > 0 ? (
              <div
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
                {normalSystems.map((system) => (
                  <SystemCard
                    key={system.id}
                    system={system}
                    to={`/library/system/${system.id}`}
                    compact={compact}
                    list={list}
                    selectable={bulk.bulkMode}
                    selected={bulk.selectedIds.has(system.id)}
                    onToggleSelect={(mods) =>
                      bulk.toggleItem(system.id, {
                        ...mods,
                        // Parent containers are excluded from bulk actions, so
                        // they're left out of the range list too — a shift-drag
                        // across one must not sweep it into the selection.
                        orderedIds: selectableSystems.map((s) => s.id),
                      })
                    }
                  />
                ))}
              </div>
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
            <h2 style={{ fontSize: 28, marginBottom: 8 }}>{t('library.title')}</h2>
            <p
              style={{
                color: 'var(--text-dim)',
                fontSize: 17,
                fontFamily: 'Alegreya, serif',
                fontStyle: 'italic',
              }}
            >
              {t('library.subtitle', { count: 0 })}
            </p>
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
