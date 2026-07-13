import { useTranslation } from 'react-i18next'
import GalleryToolbar from './GalleryToolbar'
import TagFilterBar from './TagFilterBar'
import MediaFolderGroup from './MediaFolderGroup'
import BulkActionBar from '../BulkActionBar'

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
          <GalleryToolbar
            config={config}
            filter={gallery.filter}
            onFilter={gallery.setFilter}
            bulkMode={bulkMode}
            showBulk={!isPlayer}
            onToggleBulk={bulkMode ? gallery.bulk.exit : gallery.bulk.enter}
            collapseDisabled={gallery.noFolders || bulkMode || gallery.allCollapsed}
            expandDisabled={gallery.noFolders || bulkMode || gallery.allExpanded}
            onCollapseAll={() => gallery.setCollapsed(gallery.allKeys)}
            onExpandAll={() => gallery.setCollapsed(new Set())}
            viewMode={gallery.viewMode}
            onCycleViewMode={gallery.cycleViewMode}
            favOnly={gallery.favOnly}
            onToggleFavOnly={() => gallery.setFavOnly((v) => !v)}
          />
        </div>

        {!bulkMode && (
          <TagFilterBar
            tags={gallery.allTags}
            selected={gallery.selectedTags}
            onToggle={gallery.toggleTag}
            onClear={gallery.clearTags}
          />
        )}

        {bulkMode && (
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>
            {t('bulk.hint')}
          </p>
        )}

        {gallery.folderEntries.map(([folder, subfolders]) => (
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
        ))}

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
