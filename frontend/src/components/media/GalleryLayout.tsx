import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import GalleryToolbar from './GalleryToolbar'
import MediaFolderGroup from './MediaFolderGroup'
import type { FolderDownload } from './MediaFolderGroup'
import MediaCard from './MediaCard'
import VirtualGrid from './VirtualGrid'
import type { VirtualGridHandle } from './VirtualGridRows'
import BulkActionBar from '../BulkActionBar'
import LoadMoreSentinel from '../LoadMoreSentinel'
import Spinner from '../Spinner'
import BulkToggleButton from '../BulkToggleButton'
import ViewModeToggle from '../ViewModeToggle'
import SortFilterBar from '../library/SortFilterBar'
import type { SortFilterState } from '../library/SortFilterBar'
import SearchInput from '../library/SearchInput'
import IndexedLayout from '../thumbIndex/IndexedLayout'
import ThumbIndex from '../thumbIndex/ThumbIndex'
import FolderPath from '../folders/FolderPath'
import PinnedStrip from '../pins/PinnedStrip'
import PinButton from '../pins/PinButton'
import usePins, { type PinCollection } from '../../hooks/usePins'
import useSlashToSearch from '../../hooks/useSlashToSearch'
import { ROOT_FOLDER, type FolderEntry } from '../../hooks/useMediaGallery'
import { indexLetter, type RailTab } from '../../utils/thumbIndex'
import { toTitleCase } from '../../utils'
import scrollParent from '../../utils/scrollParent'
import { titleCaseTag } from '../../hooks/useTagLabels'
import useBulkMerge from '../../hooks/useBulkMerge'
import type useMediaGallery from '../../hooks/useMediaGallery'
import type { MediaConfig, MediaItem } from './mediaConfig'
import { RECENTLY_ADDED_DAYS } from '../../utils/recentlyAdded'
import usePageTitle from '../../hooks/usePageTitle'

// The flat list gets a rail once it is this long.
const MIN_FLAT_INDEXED = 30

/** A month key ("2026-11") as a short rail label ("Nov 26"). */
function monthLabel(key: string, locale: string): string {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return key
  return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }).format(
    new Date(Date.UTC(year, month - 1, 15))
  )
}

/** Focus the card at whole-list position `offset` once the grid has drawn it. */
function focusItemAt(container: HTMLElement | null, offset: number): void {
  let tries = 0
  const tick = () => {
    const cell = container?.querySelector(`[aria-posinset="${offset + 1}"]`)
    const target = cell?.querySelector<HTMLElement>('a[href], button')
    if (target) target.focus({ preventScroll: true })
    else if (tries++ < 30) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

interface Props {
  config: MediaConfig
  gallery: ReturnType<typeof useMediaGallery<MediaItem>>
  isPlayer: boolean
  title: ReactNode
  subtitle: ReactNode
  onDownload?: (download: FolderDownload) => void
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
  const { t, i18n: i18next } = useTranslation()
  const { i18n, icon: Icon, emptyKey, emptyFilterKey, countKey } = config
  const { bulkMode } = gallery.bulk
  const lang = i18next?.language
  const openFolder = gallery.folder
  const folderName = openFolder ? toTitleCase(openFolder.split('/').pop() || openFolder) : null
  const rootLabel = typeof title === 'string' ? title : t(`nav.${config.collection}`)
  // Every gallery passes its title as a string; RouteAnnouncer reads it out.
  usePageTitle(typeof title === 'string' ? (folderName ? `${folderName} · ${title}` : title) : null)

  const searchRef = useRef<HTMLInputElement>(null)
  useSlashToSearch(searchRef)
  const pins = usePins(config.collection as PinCollection)

  // A folder's own address: this page, with `folder` set (or cleared for the
  // whole collection) and the sort and filters kept.
  const [searchParams] = useSearchParams()
  const { pathname } = useLocation()
  const folderHref = (path: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (path) next.set('folder', path)
    else next.delete('folder')
    const query = next.toString()
    return query ? `${pathname}?${query}` : pathname
  }

  // Opening a folder is a new page in all but address: start at its top and
  // put focus on its heading, so a screen reader announces where it landed.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shownFolder = useRef(openFolder)
  useEffect(() => {
    if (shownFolder.current === openFolder) return
    shownFolder.current = openFolder
    scrollParent(headingRef.current)?.scrollTo?.({ top: 0 })
    headingRef.current?.focus({ preventScroll: true })
  }, [openFolder])

  // Opened at a folder, the subtitle counts what is in it rather than the
  // whole collection.
  const folderTotal = [...(gallery.ownFolder ? [gallery.ownFolder] : []), ...gallery.folderEntries]
    .flatMap(([, subfolders]) => Object.values(subfolders))
    .reduce((n, sub) => n + sub.count, 0)

  // "9 folders · 1,012 maps", for the rail and the letter headings.
  const describeFolders = (run: Pick<RailTab, 'count' | 'units'>) =>
    `${t('thumbIndex.folders', { count: run.count })} · ${t(`${i18n}.${countKey}`, {
      count: run.units || 0,
    })}`

  // ----- The flat list's rail: server landmarks, jumping by offset -----
  const gridRef = useRef<VirtualGridHandle | null>(null)
  const flatWrapRef = useRef<HTMLDivElement>(null)
  const [firstVisible, setFirstVisible] = useState(0)
  const pendingJump = useRef<number | null>(null)
  const flatEntries = gallery.flatIndex
  const flatRail =
    !gallery.grouped && flatEntries.length > 1 && (gallery.flatTotal ?? 0) >= MIN_FLAT_INDEXED
  const flatCurrent = useMemo(() => {
    const position = gallery.flatStart + firstVisible
    let key: string | null = null
    for (const entry of flatEntries) {
      if ((entry.offset ?? 0) > position) break
      key = entry.key
    }
    return key
  }, [flatEntries, gallery.flatStart, firstVisible])
  const jumpFlat = (tab: RailTab) => {
    const offset = tab.offset ?? 0
    const from = gallery.flatStart
    if (offset >= from && offset < from + gallery.flatItems.length) {
      gridRef.current?.scrollToItem(offset - from)
      focusItemAt(flatWrapRef.current, offset)
      return
    }
    // Not loaded: reopen the list right there instead of paging through
    // everything before it.
    pendingJump.current = offset
    gallery.jumpFlat(offset)
  }
  const flatStartRef = useRef(gallery.flatStart)
  useEffect(() => {
    const before = flatStartRef.current
    flatStartRef.current = gallery.flatStart
    const pending = pendingJump.current
    if (pending !== null) {
      if (gallery.flatStart !== pending || !gallery.flatItems.length) return
      pendingJump.current = null
      gridRef.current?.scrollToItem(0)
      focusItemAt(flatWrapRef.current, pending)
      return
    }
    // Earlier rows arrived above: keep the reader on the row they were at.
    if (gallery.flatStart < before) gridRef.current?.scrollToItem(before - gallery.flatStart)
  }, [gallery.flatStart, gallery.flatItems.length])
  const flatLabel = (label: string) =>
    gallery.sortFilter.sort === 'added_at'
      ? label
        ? monthLabel(label, lang)
        : t('thumbIndex.undated')
      : label

  const renderGroup = (
    [folder, subfolders, name]: FolderEntry<MediaItem>,
    level: 2 | 3,
    own = false
  ) => (
    <MediaFolderGroup
      key={folder}
      config={config}
      folder={folder}
      label={own ? t('folderNav.here', { folder: toTitleCase(name) }) : name}
      headingLevel={level}
      folderHref={own ? undefined : (path: string) => folderHref(path)}
      isPinned={pins.isPinned}
      onTogglePin={own ? undefined : (path: string) => void pins.toggle(path)}
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
      onFetchFolderItems={gallery.fetchFolderItems as (paths: string[]) => Promise<MediaItem[]>}
    />
  )
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
  const { folderEntries, flatItems } = gallery
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
          <div style={{ minWidth: 0 }}>
            {openFolder && (
              <FolderPath
                rootLabel={rootLabel}
                folder={openFolder}
                allFolders={gallery.allFolders}
                hrefFor={folderHref}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="focus-target"
                style={{ fontSize: 28, margin: 0, overflowWrap: 'anywhere' }}
              >
                {folderName ?? title}
              </h1>
              {openFolder && !bulkMode && (
                <PinButton
                  name={folderName || openFolder}
                  pinned={pins.isPinned(openFolder)}
                  onToggle={() => void pins.toggle(openFolder)}
                />
              )}
            </div>
            {/* Live, so narrowing the gallery with the search box or a filter
                tells a screen reader how many items are left. */}
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
              {openFolder && gallery.grouped
                ? t(`${i18n}.${countKey}`, { count: folderTotal })
                : subtitle}
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
                inputRef={searchRef}
                shortcut="/"
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

        <PinnedStrip
          label={t('pins.foldersLabel', { collection: rootLabel })}
          links={pins.pins.map((pin) => {
            const parts = pin.target.split('/')
            const last = parts.pop() || pin.target
            return {
              pin,
              label: toTitleCase(last),
              detail: parts.length ? parts.map((p) => toTitleCase(p)).join(' › ') : undefined,
              to: folderHref(pin.target),
            }
          })}
          onUnpin={(pin) => void pins.toggle(pin.target)}
        />

        {/* Single sticky toolbar row: sort + filters on the left, multi-select
            and view-mode on the right (#255). Stays mounted in bulk mode so the
            Cancel button remains reachable; the sort/filter controls themselves
            are inert there but harmless. */}
        <SortFilterBar
          sticky
          // The gallery's state always carries `filters` and a default sort;
          // SortFilterBar's type is the looser one every list shares.
          state={gallery.sortFilter as SortFilterState}
          onChange={gallery.setSortFilter as (next: SortFilterState) => void}
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

        {/* Grouped by folder (default) or a single flat sorted grid. Grouped,
            a long run of folders gets letter headings and the thumb index;
            opened at a folder, that folder's own items come first. */}
        {gallery.grouped ? (
          <>
            {gallery.ownFolder && renderGroup(gallery.ownFolder, 2, true)}
            <IndexedLayout
              items={folderEntries}
              enabled
              keyOf={([folder, , name]) => (folder === ROOT_FOLDER ? '#' : indexLetter(name, lang))}
              nameOf={([, , name]) => toTitleCase(name)}
              unitsOf={([, subfolders]) =>
                Object.values(subfolders).reduce((n, sub) => n + sub.count, 0)
              }
              scope={config.collection}
              railLabel={t('thumbIndex.jumpFolders')}
              describe={describeFolders}
              headingLevel={2}
              renderItems={(entries, sectioned) =>
                entries.map((entry) => renderGroup(entry, sectioned ? 3 : 2))
              }
              version={gallery.collapsed}
            />
          </>
        ) : (
          gallery.flatItems.length > 0 && (
            <div className={flatRail ? 'indexed-layout' : undefined}>
              <div ref={flatWrapRef} className={flatRail ? 'indexed-layout__list' : undefined}>
                {gallery.flatHasEarlier && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                    <button
                      type="button"
                      onClick={gallery.loadEarlierFlat}
                      disabled={gallery.flatLoading}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 6,
                        fontSize: 13,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-dim)',
                      }}
                    >
                      {t('thumbIndex.showEarlier', { count: gallery.flatStart })}
                    </button>
                  </div>
                )}
                <VirtualGrid
                  items={flatItems}
                  minColumn={parseInt(config.gridMin[gallery.cardSize], 10)}
                  gap={gallery.list ? 8 : config.gridGap}
                  list={gallery.list}
                  indexOffset={gallery.flatStart}
                  setSize={gallery.flatTotal ?? undefined}
                  onFirstVisible={setFirstVisible}
                  handleRef={gridRef}
                  renderItem={(item) => (
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
              </div>
              {flatRail && (
                <ThumbIndex
                  entries={flatEntries}
                  current={flatCurrent}
                  onJump={jumpFlat}
                  label={t('thumbIndex.jumpItems', { collection: rootLabel })}
                  describe={(tab) => t(`${i18n}.${countKey}`, { count: tab.count })}
                  formatLabel={flatLabel}
                  scope={`${config.collection}-flat`}
                />
              )}
            </div>
          )
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
