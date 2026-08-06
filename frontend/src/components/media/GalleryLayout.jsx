import { useTranslation } from 'react-i18next'
import GalleryToolbar from './GalleryToolbar'
import MediaFolderGroup from './MediaFolderGroup'
import MediaCard from './MediaCard'
import LazyGrid from '../LazyGrid'
import BulkActionBar from '../BulkActionBar'
import BulkToggleButton from '../BulkToggleButton'
import ViewModeToggle from '../ViewModeToggle'
import SortFilterBar from '../library/SortFilterBar'
import SearchInput from '../library/SearchInput'
import useTagLabels, { titleCaseTag } from '../../hooks/useTagLabels'

/**
 * Page layout shared by the media gallery views (maps, tokens). Renders the
 * header, toolbar, tag-filter bar, folder list, empty state, and bulk action
 * bar from the `gallery` state produced by useMediaGallery. View-specific modals
 * (download, add-to-campaign, bulk edit) stay in the view, wired via the
 * onDownload / onAddToCampaign / onBulkEdit callbacks.
 */
export default function GalleryLayout({
  config,
  gallery,
  isPlayer,
  title,
  subtitle,
  onSelectItem,
  onDownload,
  onAddToCampaign,
  onBulkEdit,
}) {
  const { t } = useTranslation()
  const { i18n, icon: Icon, emptyKey, emptyFilterKey } = config
  const { bulkMode } = gallery.bulk

  const sortOptions = (config.sortOptions || ['name', 'size']).map((key) => ({
    value: key,
    label: t(`sortFilter.sort${key.charAt(0).toUpperCase()}${key.slice(1)}`),
  }))
  // Tag filter options: values are the internal (lowercased) keys the gallery
  // matches on; labels use the shared-tag display casing when available, falling
  // back to Title Case for folder-only tags not in the shared-tag tables (#235).
  const tagLabels = useTagLabels(config.type)
  const tagOptions = gallery.allTags.map((tg) => ({
    value: tg,
    label: tagLabels[tg] || titleCaseTag(tg),
  }))
  const handleSavePreset = (name, opts) => gallery.savedFilters.save(name, gallery.sortFilter, opts)

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
        <div
          style={{
            marginBottom: 32,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div>
            <h2 style={{ fontSize: 28, marginBottom: 8 }}>{title}</h2>
            <p
              style={{
                color: 'var(--text-dim)',
                fontSize: 17,
                fontFamily: 'Alegreya, serif',
                fontStyle: 'italic',
              }}
            >
              {subtitle}
            </p>
          </div>
          {/* Right-hand header panel: the search box sits in the top-right
              corner (like the book search), with the view controls beneath it. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 8,
              minWidth: 0,
              flex: '1 1 280px',
              maxWidth: 420,
            }}
          >
            {!bulkMode && (
              <SearchInput
                value={gallery.filter}
                onChange={gallery.setFilter}
                placeholder={t(`${i18n}.filterPlaceholder`)}
              />
            )}
            <GalleryToolbar config={config} gallery={gallery} />
          </div>
        </div>

        {/* Single sticky toolbar row: sort + filters on the left, multi-select
            and view-mode on the right (#255). Stays mounted in bulk mode so the
            Cancel button remains reachable; the sort/filter controls themselves
            are inert there but harmless. */}
        <SortFilterBar
          sticky
          state={gallery.sortFilter}
          onChange={gallery.setSortFilter}
          sortOptions={sortOptions}
          showSearch={false}
          multiFilters={[
            {
              key: 'tags',
              label: t('sortFilter.filterTags'),
              emptyLabel: t('sortFilter.noTags'),
              options: tagOptions,
            },
          ]}
          toggleFilters={[
            { key: 'favorites', label: t('sortFilter.filterFavorites'), boolean: true },
          ]}
          saved={gallery.savedFilters.saved}
          onSavePreset={handleSavePreset}
          onSetDefault={gallery.savedFilters.setDefault}
          onDeletePreset={gallery.savedFilters.remove}
          trailing={
            <>
              {!isPlayer && (
                <BulkToggleButton
                  active={bulkMode}
                  onToggle={bulkMode ? gallery.bulk.exit : gallery.bulk.enter}
                />
              )}
              <ViewModeToggle mode={gallery.viewMode} onCycle={gallery.cycleViewMode} />
            </>
          }
        />

        {bulkMode && (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>
            {t('bulk.hint')}
          </p>
        )}

        {/* Grouped by folder (default) or a single flat sorted grid. */}
        {gallery.grouped
          ? gallery.folderEntries.map(([folder, subfolders]) => (
              <MediaFolderGroup
                key={folder}
                config={config}
                folder={folder}
                subfolders={subfolders}
                cardSize={gallery.cardSize}
                list={gallery.list}
                collapsed={gallery.collapsed}
                onToggle={gallery.toggleCollapse}
                folderTags={gallery.folderTags}
                editingFolder={isPlayer ? null : gallery.editingFolder}
                onSetEditingFolder={isPlayer ? () => {} : gallery.setEditingFolder}
                onSaveFolderTags={isPlayer ? () => {} : gallery.saveFolderTags}
                canTag={!isPlayer}
                onSelectItem={onSelectItem}
                bulkMode={bulkMode}
                selectedIds={gallery.selectedIds}
                selectedFolderPaths={gallery.selectedFolderPaths}
                onToggleItem={gallery.toggleSelect}
                onToggleFolder={gallery.bulk.toggleFolder}
                onDownload={onDownload}
              />
            ))
          : gallery.flatItems.length > 0 && (
              <LazyGrid>
                <div
                  style={
                    gallery.list
                      ? { display: 'flex', flexDirection: 'column', gap: 8 }
                      : {
                          display: 'grid',
                          gridTemplateColumns: `repeat(auto-fill, minmax(${config.gridMin[gallery.cardSize]}, 1fr))`,
                          gap: config.gridGap,
                        }
                  }
                >
                  {gallery.flatItems.map((item) => (
                    <MediaCard
                      key={item.id}
                      config={config}
                      item={item}
                      onClick={() => onSelectItem(item.id)}
                      bulkMode={bulkMode}
                      selected={gallery.selectedIds?.has(item.id)}
                      onToggle={(mods) => gallery.toggleSelect(item.id, mods)}
                      list={gallery.list}
                    />
                  ))}
                </div>
              </LazyGrid>
            )}

        {gallery.noFolders && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
            <Icon size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
            <p>
              {gallery.favOnly
                ? t('favorites.noFavoritesInView')
                : gallery.filter
                  ? t(`${i18n}.${emptyFilterKey}`)
                  : t(`${i18n}.${emptyKey}`)}
            </p>
          </div>
        )}
      </div>

      {bulkMode && (
        <BulkActionBar
          count={gallery.totalSelected}
          applying={gallery.bulkApplying}
          onApplyTags={gallery.applyBulkTags}
          onAddToCampaign={onAddToCampaign}
          onBulkEdit={onBulkEdit}
          onDone={gallery.bulk.exit}
        />
      )}
    </div>
  )
}
