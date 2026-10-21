import type { ComponentType, ReactNode } from 'react'
import type { IconType } from 'react-icons'
import { useTranslation } from 'react-i18next'
import GalleryToolbar from './GalleryToolbar'
import MediaFolderGroupJs from './MediaFolderGroup'
import MediaCard from './MediaCard'
import VirtualGrid from './VirtualGrid'
import BulkActionBar from '../BulkActionBar'
import LoadMoreSentinel from '../LoadMoreSentinel'
import Spinner from '../Spinner'
import BulkToggleButton from '../BulkToggleButton'
import ViewModeToggle from '../ViewModeToggle'
import SortFilterBarJs from '../library/SortFilterBar'
import SearchInput from '../library/SearchInput'
import { titleCaseTag } from '../../hooks/useTagLabels'
import useBulkMerge from '../../hooks/useBulkMerge'
import type useMediaGallery from '../../hooks/useMediaGallery'
import type { GalleryConfig, GalleryItem } from '../../hooks/useMediaGallery'
import { RECENTLY_ADDED_DAYS } from '../../utils/recentlyAdded'

// MediaFolderGroup is still JavaScript, and infers its callbacks' arity from
// their defaults.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MediaFolderGroup = MediaFolderGroupJs as ComponentType<Record<string, any>>

// SortFilterBar is still JavaScript; its filter lists default to `[]`, which
// TypeScript would otherwise read as lists that can hold nothing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SortFilterBar = SortFilterBarJs as ComponentType<Record<string, any>>

/** The mediaConfig.js entry, with the fields the page layout reads. */
interface LayoutConfig extends GalleryConfig {
  i18n: string
  icon: IconType
  emptyKey: string
  emptyFilterKey: string
  sortOptions?: string[]
  gridMin: Record<string, string>
  gridGap: number
}

interface Props {
  config: LayoutConfig
  gallery: ReturnType<typeof useMediaGallery>
  isPlayer: boolean
  title: ReactNode
  subtitle: ReactNode
  onDownload?: (...args: unknown[]) => void
  onAddToCampaign?: () => void
  onBulkEdit?: () => void
  onAddToSoundboard?: () => void
  headerActions?: ReactNode
}

/**
 * Page layout shared by the media gallery views (maps, tokens). Renders the
 * header, toolbar, tag-filter bar, folder list, empty state, and bulk action
 * bar from the `gallery` state produced by useMediaGallery. View-specific modals
 * (download, add-to-campaign, bulk edit) stay in the view, wired via the
 * onDownload / onAddToCampaign / onBulkEdit callbacks. onAddToSoundboard and
 * headerActions (an extra control at the head of the view-toolbar row) are
 * audio-only and simply omitted by the other galleries.
 */
export default function GalleryLayout({
  config,
  gallery,
  isPlayer,
  title,
  subtitle,
  onDownload,
  onAddToCampaign,
  onBulkEdit,
  onAddToSoundboard,
  headerActions,
}: Props) {
  const { t } = useTranslation()
  const { i18n, icon: Icon, emptyKey, emptyFilterKey } = config
  const { bulkMode } = gallery.bulk
  // Merge (issue #589): every selected item here is one collection, so the
  // only rules left are the count and the admin check inside the hook.
  const merge = useBulkMerge(
    [...gallery.selectedIds].map((id) => ({ type: config.type, id: id as string })),
    (outcome) => gallery.removeItems(outcome.removedIds)
  )

  // Every gallery can sort by date added (issue #199), newest first on pick.
  // Snake-case keys map to camel-case labels: `added_at` -> `sortAddedAt`.
  const sortOptions = [...(config.sortOptions || ['name', 'size']), 'added_at'].map((key) => {
    const camel = key.replace(/_(\w)/g, (_: string, c: string) => c.toUpperCase())
    return {
      value: key,
      label: t(`sortFilter.sort${camel.charAt(0).toUpperCase()}${camel.slice(1)}`),
      ...(key === 'added_at' ? { defaultOrder: 'desc' } : null),
    }
  })
  // Tag filter options: values are the internal (lowercased) keys the gallery
  // matches on; labels use the shared-tag display casing when available, falling
  // back to Title Case for folder-only tags not in the shared-tag tables (#235).
  const tagLabels: Record<string, string> = gallery.tagLabels || {}
  const tagOptions = gallery.allTags.map((tg: string) => ({
    value: tg,
    label: tagLabels[tg] || titleCaseTag(tg),
  }))
  const handleSavePreset = (name: string, opts?: { asDefault?: boolean }) =>
    gallery.savedFilters.save(name, gallery.sortFilter, opts)

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
                ariaLabel={undefined}
                style={undefined}
              />
            )}
            <GalleryToolbar config={config} gallery={gallery} leading={headerActions} />
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
          queryFilters={[
            {
              key: 'tags',
              label: t('sortFilter.filterTags'),
              emptyLabel: t('sortFilter.noTags'),
              options: tagOptions,
            },
          ]}
          toggleFilters={[
            { key: 'favorites', label: t('sortFilter.filterFavorites'), boolean: true },
            {
              key: 'recent',
              label: t('sortFilter.filterRecent', { days: RECENTLY_ADDED_DAYS }),
              boolean: true,
            },
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
                  style={undefined}
                />
              )}
              <ViewModeToggle
                mode={gallery.viewMode}
                onCycle={gallery.cycleViewMode}
                style={undefined}
              />
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
                frameFolders={gallery.frameFolders}
                editingFolder={isPlayer ? null : gallery.editingFolder}
                onSetEditingFolder={isPlayer ? () => {} : gallery.setEditingFolder}
                onSaveFolderTags={isPlayer ? () => {} : gallery.saveFolderTags}
                canTag={!isPlayer}
                bulkMode={bulkMode}
                selectedIds={gallery.selectedIds}
                selectedFolderPaths={gallery.selectedFolderPaths}
                onToggleItem={gallery.toggleSelect}
                onToggleFolder={gallery.bulk.toggleFolder}
                onDownload={onDownload}
                onLoadFolder={gallery.loadFolder}
                onFetchFolderItems={gallery.fetchFolderItems}
              />
            ))
          : gallery.flatItems.length > 0 && (
              <>
                <VirtualGrid
                  items={gallery.flatItems}
                  minColumn={parseInt(config.gridMin[gallery.cardSize], 10)}
                  gap={gallery.list ? 8 : config.gridGap}
                  list={gallery.list}
                  renderItem={(item: GalleryItem) => (
                    <MediaCard
                      key={item.id}
                      config={config}
                      item={item}
                      bulkMode={bulkMode}
                      selected={gallery.selectedIds?.has(item.id)}
                      onToggle={(mods: { shift?: boolean; meta?: boolean }) =>
                        gallery.toggleSelect(item.id, mods)
                      }
                      list={gallery.list}
                    />
                  )}
                />
                {/* The flat list pages in as its end scrolls near (issue #221). */}
                {gallery.flatLoading && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
                    <Spinner size={20} />
                  </div>
                )}
                <LoadMoreSentinel
                  active={gallery.flatHasMore && !gallery.flatLoading}
                  count={gallery.flatItems.length}
                  onVisible={gallery.loadMoreFlat}
                />
              </>
            )}

        {gallery.noItems && (
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
          onAddToSoundboard={onAddToSoundboard}
          {...merge.barProps}
          onDone={gallery.bulk.exit}
        />
      )}
      {merge.dialog}
    </div>
  )
}
