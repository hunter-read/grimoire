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
import useTagLabels, { titleCaseTag } from '../hooks/useTagLabels'
import SystemCard from '../components/library/SystemCard'
import AgnosticChip from '../components/library/AgnosticChip'
import SortFilterBar from '../components/library/SortFilterBar'
import { applySystemSortFilter } from '../components/library/applySystemSortFilter'
import BulkActionBar from '../components/BulkActionBar'
import BulkEditModal from '../components/BulkEditModal'
import LazyImg from '../components/LazyImg'

const DEFAULT_SORT_FILTER = { sort: 'name', order: 'asc', filters: {} }

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
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [sortFilter, setSortFilter] = useState(DEFAULT_SORT_FILTER)
  // Tracks whether we've applied the server-side default preset for this mount,
  // so a user's later manual changes aren't clobbered by the default.
  const [defaultApplied, setDefaultApplied] = useState(false)
  const library = useSystemLibrary(systems, setSystems)
  const { bulk, allTags } = library
  // Shared-tag display labels for system tags (values still match on internal key).
  const systemTagLabels = useTagLabels('system')
  const {
    saved: savedFilters,
    loaded: filtersLoaded,
    defaultFilter,
    save: savePreset,
    setDefault: setPresetDefault,
    remove: removePreset,
  } = useSavedFilters('systems')

  useEffect(() => {
    api.get('/systems').then(setSystems)
  }, [])

  // On load, apply the user's default preset (if any) exactly once.
  useEffect(() => {
    if (filtersLoaded && !defaultApplied) {
      if (defaultFilter?.state) setSortFilter(defaultFilter.state)
      setDefaultApplied(true)
    }
  }, [filtersLoaded, defaultApplied, defaultFilter])

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
  // Tags currently filtering the grid (set via the Filters modal's Tags dropdown).
  const selectedTags = new Set((activeFilters.tags || []).map((tg) => tg.toLowerCase()))
  const favOnly = activeFilters.favorites === true
  const isFavSystem = (id) => isFavorite('system', id)

  // A container folder holds systems rather than books of its own, so it stays
  // visible on the strength of its children (issues #261, #262).
  const visible = (s) => s.book_count > 0 || (s.container_kind && s.child_count > 0)

  // "Special" collections (system-agnostic + one-page/small RPGs) are grouped
  // together above the regular game systems and shown as compact chips.
  // Parent-system containers ("Dungeons & Dragons" holding its editions) are
  // ordinary library entries and stay in the main grid.
  const isSpecial = (s) => s.is_system_agnostic || s.is_one_page

  // The bar filters (genre/family/explicit/favorites/tags), then sorts.
  const normalSystems = applySystemSortFilter(
    systems.filter((s) => visible(s) && !isSpecial(s)),
    sortFilter,
    { isFavorite: isFavSystem }
  )

  // Bulk tagging and bulk edit are undefined for a parent container (it holds
  // systems, not books of its own), so it never takes part in a selection —
  // including as a member of a shift-click range.
  const selectableSystems = normalSystems.filter((s) => s.container_kind !== 'parent')

  // Special collections keep a simple A–Z ordering.
  const specialSystems = systems
    .filter((s) => visible(s) && isSpecial(s))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Filter dropdown options derived from the loaded systems (regular only).
  const genreOptions = [
    ...new Set(systems.filter((s) => !isSpecial(s)).flatMap((s) => s.genres || [])),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((g) => ({ value: g, label: g }))
  const familyOptions = [
    ...new Set(systems.filter((s) => !isSpecial(s) && s.system_family).map((s) => s.system_family)),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((f) => ({ value: f, label: f }))
  const parentSystemOptions = [
    ...new Set(systems.filter((s) => !isSpecial(s) && s.parent_system).map((s) => s.parent_system)),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((p) => ({ value: p, label: p }))
  const editionOptions = [
    ...new Set(systems.filter((s) => !isSpecial(s) && s.edition).map((s) => s.edition)),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((e) => ({ value: e, label: e }))
  const diceOptions = [
    ...new Set(systems.filter((s) => !isSpecial(s)).flatMap((s) => s.dice_materials || [])),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((d) => ({ value: d, label: d }))
  const tagOptions = allTags.map((tg) => ({
    value: tg,
    label: systemTagLabels[tg] || titleCaseTag(tg),
  }))

  const tagFiltered = selectedTags.size > 0
  // Whether the library holds any browsable regular (non-special) systems at
  // all, ignoring the favorites/tag filters — drives the "Game Systems" section
  // (its toolbar, tag filter, and empty states). Special-only libraries skip it
  // and rely on the special-collection chips section above.
  const hasNormalSystems = systems.some((s) => visible(s) && !isSpecial(s))
  // Whether the library is completely empty (no browsable systems of any kind).
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
              <h2 style={{ fontSize: 28, marginBottom: 8 }}>{t('library.title')}</h2>
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
                ...(editionOptions.length
                  ? [
                      {
                        key: 'edition',
                        label: t('sortFilter.filterEdition'),
                        allLabel: t('sortFilter.allEditions'),
                        options: editionOptions,
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
            bulk.exit()
          }}
        />
      )}
    </div>
  )
}
