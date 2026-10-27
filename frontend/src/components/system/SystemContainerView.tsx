import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuLibrary, LuPencil } from 'react-icons/lu'
import SystemCard from '../library/SystemCard'
import SystemSortFilterBar from '../library/SystemSortFilterBar'
import { applySystemSortFilter } from '../library/applySystemSortFilter'
import BulkActionBar from '../BulkActionBar'
import BulkEditModal from '../BulkEditModal'
import CoverUpload from './CoverUpload'
import { useFavorites } from '../../context/FavoritesContext'
import useSavedFilters from '../../hooks/useSavedFilters'
import useSortFilterState from '../../hooks/useSortFilterState'
import useSystemLibrary from '../../hooks/useSystemLibrary'
import { systemDisplayName } from '../../utils/systemDisplayName'
import { systemCoverUrl } from '../../utils/systemCoverUrl'

/**
 * Detail view for a *container* system — a folder whose children are systems in
 * their own right rather than categories (issues #261, #262).
 *
 * Parent-system containers ("Dungeons & Dragons" holding 3e/4e/5e) and one-page
 * collections ("One Page RPGs" holding dozens of tiny games) share this view:
 * both present their children as a grid of system cards, so navigating into a
 * container feels the same as the main library grid rather than dropping into a
 * flat book list.
 *
 * The children get the main library's toolbar - name search, sort, filters,
 * saved presets, multi-select and view mode (issue #500) - since a container is
 * a smaller library in its own right.
 *
 * Any books sitting loose at the container's own root are rendered underneath by
 * the caller, which owns the normal book-list rendering.
 *
 * @param onChildrenChange  (updater) => void, patches the children after a bulk
 *   tag or edit so the grid updates without a refetch
 */
export default function SystemContainerView({
  system,
  viewMode,
  onCycleViewMode,
  canEdit = false,
  backLabel,
  onBack,
  onCoverChange,
  onChildrenChange,
}) {
  const { t } = useTranslation()
  const { isFavorite } = useFavorites()
  const [editingCover, setEditingCover] = useState(false)
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const children = system.children || []
  const library = useSystemLibrary(children, onChildrenChange)
  const { bulk } = library
  const systemFilters = useSavedFilters('systems')
  // Kept per container, so coming back from a child restores this grid's own
  // search and filters rather than the main library's.
  const [sortFilter, setSortFilter] = useSortFilterState(
    `grimoire:system:${system.id}:sortFilter`,
    systemFilters
  )
  const shown = applySystemSortFilter(children, sortFilter, {
    isFavorite: (id) => isFavorite('system', id),
  })
  // A nested container holds systems rather than books, so like the main
  // library it never takes part in a bulk selection or a shift-click range.
  const selectable = shown.filter((s) => !s.container_kind)
  const coverUrl = systemCoverUrl(system)
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
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            padding: 0,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          <LuArrowLeft size={16} />
          {backLabel || t('systemDetail.backToLibrary')}
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                style={{
                  width: 60,
                  height: 80,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  flexShrink: 0,
                  display: 'block',
                }}
              />
            ) : (
              <LuLibrary size={22} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
            )}
            <h1 style={{ fontSize: 28, margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
              {systemDisplayName(system)}
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {canEdit && (
              <button
                onClick={() => setEditingCover((v) => !v)}
                title={t('systemEditor.uploadCover')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: 'none',
                  border: '1px solid var(--border)',
                  color: 'var(--text-dim)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <LuPencil size={13} /> {t('systemEditor.uploadCover')}
              </button>
            )}
          </div>
        </div>

        <p
          style={{
            color: 'var(--text-dim)',
            fontSize: 15,
            fontFamily: 'Alegreya, serif',
            fontStyle: 'italic',
            marginBottom: 20,
          }}
        >
          {system.description || t('systemContainer.subtitle', { count: children.length })}
        </p>

        {canEdit && editingCover && (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 20,
              marginBottom: 24,
            }}
          >
            <CoverUpload system={system} onChange={onCoverChange} />
          </div>
        )}

        {children.length > 0 && (
          <SystemSortFilterBar
            systems={children}
            tags={library.allTags}
            state={sortFilter}
            onChange={setSortFilter}
            saved={systemFilters}
            bulk={bulk}
            canEdit={canEdit}
            viewMode={viewMode}
            onCycleViewMode={onCycleViewMode}
          />
        )}

        {children.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('systemContainer.empty')}</p>
        ) : shown.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            {t('systemContainer.noMatch')}
          </p>
        ) : (
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
            {shown.map((child) => (
              <SystemCard
                key={child.id}
                system={child}
                to={`/library/system/${child.id}`}
                compact={compact}
                list={list}
                selectable={bulk.bulkMode}
                selected={bulk.selectedIds.has(child.id)}
                onToggleSelect={(mods) =>
                  bulk.toggleItem(child.id, {
                    ...mods,
                    orderedIds: selectable.map((s) => s.id),
                  })
                }
              />
            ))}
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
