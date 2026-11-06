import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  LuFolder,
  LuFolderOpen,
  LuChevronDown,
  LuChevronRight,
  LuDownload,
  LuPlay,
} from 'react-icons/lu'
import MediaCard from './MediaCard'
import VirtualGrid from './VirtualGrid'
import FolderTagRow from './FolderTagRow'
import FramesBadge from './FramesBadge'
import FolderCheckbox from '../FolderCheckbox'
import LoadMoreSentinel from '../LoadMoreSentinel'
import RescanButton from '../RescanButton'
import PinButton from '../pins/PinButton'
import Spinner from '../Spinner'
import { toTitleCase } from '../../utils'
import { useAudioPlayer } from '../../context/AudioPlayerContext'
import useIsMobile from '../../hooks/useIsMobile'
import useAsyncAction from '../../hooks/useAsyncAction'
import type { MediaConfig, MediaItem } from './mediaConfig'
import type { ToggleMods } from './MediaCard'
import { ROOT_FOLDER } from '../../hooks/useMediaGallery'

/** One folder below the group (or the group's own items, under ''). */
export interface MediaSubfolder {
  path: string
  count: number
  items: MediaItem[]
  loading?: boolean
  hasMore: boolean
}

/** What a folder's download button hands the archive modal. */
export interface FolderDownload {
  title: string
  params: { type: string; folder: string }
}

export interface MediaFolderGroupProps {
  config: MediaConfig
  folder: string
  subfolders: Record<string, MediaSubfolder>
  collapsed: Set<string>
  onToggle: (key: string) => void
  folderTags: Record<string, string[]>
  frameFolders?: Set<string>
  editingFolder: string | null
  onSetEditingFolder: (key: string | null) => void
  onSaveFolderTags: (path: string, tags: string[]) => void
  bulkMode: boolean
  selectedIds: Set<string>
  selectedFolderPaths: Set<string>
  onToggleItem: (id: string, mods: ToggleMods) => void
  onToggleFolder: (path: string, items: MediaItem[]) => void
  cardSize?: string
  list?: boolean
  canTag?: boolean
  onDownload?: (download: FolderDownload) => void
  onLoadFolder?: (path: string) => void
  onFetchFolderItems?: (paths: string[]) => Promise<MediaItem[]>
  /** The folder's name as shown, when `folder` is a deeper path ("Caverns"). */
  label?: string
  /** The folder heading's level: 2 at the top of a gallery, 3 under a letter. */
  headingLevel?: 2 | 3
  /** Where opening a folder as its own page goes; no "Open" links without it. */
  folderHref?: (path: string) => string
  /** Pinning: whether a folder path is pinned, and the toggle. */
  isPinned?: (path: string) => boolean
  onTogglePin?: (path: string) => void
}

// A small action beside a folder name (play, download, open).
type LinkStyle = CSSProperties

const zipBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 7px',
  borderRadius: 5,
  fontSize: 12,
  flexShrink: 0,
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  cursor: 'pointer',
}

// A folder heading wraps its toggle without restyling it: the global heading
// font and colour stay out, and the row keeps its flex layout.
const folderHeading: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  margin: 0,
  font: 'inherit',
  color: 'inherit',
  letterSpacing: 'normal',
}

// Audio queued from a folder: playable tracks only, in the shape the player takes.
const toTracks = (items: MediaItem[]) =>
  items
    .filter((i) => !i.is_missing)
    .map((i) => ({ id: i.id, title: i.title || i.filename, artwork: i.has_artwork }))

/**
 * Renders a top-level folder group and its subfolders for a media gallery.
 * Type-specific concerns (icon, grid sizing, endpoints, i18n keys) come from
 * `config` (see mediaConfig.ts), so a single component serves maps, tokens, etc.
 *
 * `subfolders` maps each folder below this one (or '' for its own items) to
 * `{ path, count, items, loading, hasMore }`: counts come from the server and
 * items arrive a page at a time (issue #221). An open folder asks for its next
 * page through `onLoadFolder(path)` when its end scrolls near; whatever has
 * loaded is what selection acts on, while downloads and rescans work on the
 * folder itself server-side.
 */
export default function MediaFolderGroup({
  config,
  folder,
  subfolders,
  collapsed,
  onToggle,
  folderTags,
  frameFolders,
  editingFolder,
  onSetEditingFolder,
  onSaveFolderTags,
  bulkMode,
  selectedIds,
  selectedFolderPaths,
  onToggleItem,
  onToggleFolder,
  cardSize = 'comfortable',
  list = false,
  canTag = true,
  onDownload,
  onLoadFolder = () => {},
  onFetchFolderItems,
  label,
  headingLevel = 2,
  folderHref,
  isPinned,
  onTogglePin,
}: MediaFolderGroupProps) {
  const { t } = useTranslation()
  const isMobilePhone = useIsMobile(640)
  const { i18n, archiveType, countKey, type } = config
  const { playQueue } = useAudioPlayer()
  const [editingRoot, setEditingRoot] = useState(false)
  // Only the token gallery is ever handed a frame-folder set; every other
  // collection leaves it undefined, and this then answers false for all of them.
  const isFrameFolder = (path: string) => !!frameFolders && frameFolders.has(path)

  const isCollapsed = collapsed.has(folder)
  const name = toTitleCase(label ?? folder)
  // Folder headings sit under the page's h1, or under a letter heading.
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const SubHeading = headingLevel === 3 ? 'h4' : 'h3'
  // The collection root is not a folder that can be opened or pinned.
  const realFolder = folder !== ROOT_FOLDER
  const groupsBelow = Object.values(subfolders)
  // Loaded items only - the folder may hold more than has been paged in.
  const allInGroup = groupsBelow.flatMap((g) => g.items)
  const total = groupsBelow.reduce((n, g) => n + g.count, 0)
  // Queue a folder to play: every track, fetched in full rather than only the
  // page that happens to be loaded.
  const { run: runPlay, error: playError } = useAsyncAction()
  const playFolder = (paths: string[]) => {
    const fetchItems = onFetchFolderItems
    if (!fetchItems) return
    void runPlay(async () => playQueue(toTracks(await fetchItems(paths))))
  }
  const isAudio = !!config.audioFileUrl
  const topLevelTags = folderTags[folder] ?? []

  const groupFolderChecked =
    selectedFolderPaths.has(folder) && allInGroup.every((i) => selectedIds.has(i.id))
  const groupFolderIndeterminate =
    !groupFolderChecked &&
    (selectedFolderPaths.has(folder) || allInGroup.some((i) => selectedIds.has(i.id)))

  const subfolderEntries = Object.entries(subfolders).sort(([a], [b]) => {
    if (a === '') return 1
    if (b === '') return -1
    return a.localeCompare(b)
  })

  const archiveTitle = (suffix: string) => toTitleCase(i18n) + ' — ' + suffix

  return (
    <div
      style={{
        marginBottom: 16,
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* Folder header */}
      <div
        style={{
          padding: '12px 20px',
          background: 'var(--bg-panel)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
        }}
      >
        {/* Top row: chevron + icon + name + dot leader + count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {bulkMode && (
            <FolderCheckbox
              checked={groupFolderChecked}
              indeterminate={groupFolderIndeterminate}
              onChange={() => onToggleFolder(folder, allInGroup)}
            />
          )}
          {/* The toggle inside a heading, with the count: each folder is a stop
              for heading navigation and reads "Dungeons, 12 maps". The button's
              name is the folder's own; aria-expanded says open or shut. */}
          <Heading
            style={{
              ...folderHeading,
              flex: 1,
              // On a phone the folder's actions wrap under its name rather
              // than squeezing the name out of the row.
              flexBasis: isMobilePhone ? '100%' : undefined,
              minWidth: 0,
              gap: 10,
            }}
          >
            <button
              onClick={() => onToggle(folder)}
              aria-expanded={!isCollapsed}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              {isCollapsed ? (
                <LuChevronRight size={16} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
              ) : (
                <LuChevronDown size={16} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
              )}
              <LuFolder size={16} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 18,
                  color: 'var(--gold-dim)',
                  fontFamily: 'Cinzel, serif',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {name}
              </span>
              {isFrameFolder(folder) && <FramesBadge label={t('tokens.framesFolder')} />}
              {!isMobilePhone && (
                <span
                  style={{
                    flex: 1,
                    borderBottom: '1px dotted var(--border)',
                    margin: '0 8px',
                    minWidth: 16,
                  }}
                />
              )}
            </button>
            <span style={{ fontSize: 14, color: 'var(--text-muted)', flexShrink: 0 }}>
              {t(`${i18n}.${countKey}`, { count: total })}
            </span>
          </Heading>
          {!bulkMode && folderHref && realFolder && (
            <Link
              to={folderHref(folder)}
              style={zipBtnStyle as LinkStyle}
              aria-label={t('folderNav.open', { folder: name })}
            >
              <LuFolderOpen size={11} aria-hidden="true" /> {t('folderNav.openShort')}
            </Link>
          )}
          {!bulkMode && onTogglePin && realFolder && (
            <PinButton
              name={name}
              pinned={!!isPinned?.(folder)}
              onToggle={() => onTogglePin(folder)}
            />
          )}
          {!bulkMode && isAudio && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                playFolder(groupsBelow.map((g) => g.path))
              }}
              style={zipBtnStyle}
              title={t('audio.playFolder', { folder: name })}
              aria-label={t('audio.playFolder', { folder: name })}
            >
              <LuPlay size={11} /> {t('audio.player.play')}
            </button>
          )}
          {!bulkMode && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDownload?.({
                  title: archiveTitle(name),
                  params: { type: archiveType, folder },
                })
              }}
              style={zipBtnStyle}
              title={t(`${i18n}.downloadAllInFolder`, { folder: name })}
              aria-label={t(`${i18n}.downloadAllInFolder`, { folder: name })}
            >
              <LuDownload size={11} /> {t(`${i18n}.download`)}
            </button>
          )}
          {!bulkMode && canTag && <RescanButton scope={`${i18n}/${folder}`} />}
        </div>
        {playError && (
          <p
            role="alert"
            style={{ margin: '8px 0 0', paddingLeft: 52, fontSize: 13, color: 'var(--danger)' }}
          >
            {playError}
          </p>
        )}

        {/* Tags row (desktop only — mobile shows tags below when expanded) */}
        {!bulkMode && !isMobilePhone && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexWrap: 'wrap',
              marginTop: 8,
              paddingLeft: 52,
            }}
          >
            <FolderTagRow
              tags={topLevelTags}
              editing={editingRoot}
              canTag={canTag}
              i18n={i18n}
              resourceType={type}
              onEdit={() => setEditingRoot(true)}
              onSave={(newTags) => onSaveFolderTags(folder, newTags)}
              onCancel={() => setEditingRoot(false)}
            />
          </div>
        )}
      </div>

      {/* Subfolders + items */}
      {!isCollapsed && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {isMobilePhone && !bulkMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <FolderTagRow
                tags={topLevelTags}
                editing={editingRoot}
                canTag={canTag}
                i18n={i18n}
                resourceType={type}
                fullLabels
                onEdit={() => setEditingRoot(true)}
                onSave={(newTags) => onSaveFolderTags(folder, newTags)}
                onCancel={() => setEditingRoot(false)}
              />
            </div>
          )}
          {subfolderEntries.map(([subPath, sub]) => {
            const subItems = sub.items
            const folderPath = subPath ? `${folder}/${subPath}` : folder
            const tags = folderTags[folderPath] ?? []
            const editKey = `${folder}::${subPath}`
            const isSubCollapsed = subPath ? collapsed.has(editKey) : false

            const subChecked =
              subPath &&
              selectedFolderPaths.has(folderPath) &&
              subItems.every((i) => selectedIds.has(i.id))
            const subIndeterminate =
              subPath &&
              !subChecked &&
              (selectedFolderPaths.has(folderPath) || subItems.some((i) => selectedIds.has(i.id)))

            return (
              <div key={editKey}>
                {subPath ? (
                  <div style={{ marginBottom: isSubCollapsed ? 0 : 12 }}>
                    {/* Top row: checkbox + name + count */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {bulkMode && (
                        <FolderCheckbox
                          // Only drawn for a subfolder, where subPath is non-empty and
                          // both of these are booleans.
                          checked={subChecked as boolean}
                          indeterminate={subIndeterminate as boolean}
                          onChange={() => onToggleFolder(folderPath, subItems)}
                        />
                      )}
                      <SubHeading style={{ ...folderHeading, minWidth: 0 }}>
                        <button
                          onClick={() => onToggle(editKey)}
                          aria-expanded={!isSubCollapsed}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 2px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            minWidth: 0,
                            overflow: 'hidden',
                          }}
                        >
                          {isSubCollapsed ? (
                            <LuChevronRight
                              size={13}
                              color="var(--text-muted)"
                              style={{ flexShrink: 0 }}
                            />
                          ) : (
                            <LuChevronDown
                              size={13}
                              color="var(--text-muted)"
                              style={{ flexShrink: 0 }}
                            />
                          )}
                          <LuFolder size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                          <span
                            style={{
                              fontSize: 15,
                              color: 'var(--text-dim)',
                              fontWeight: 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {subPath.split('/').map(toTitleCase).join(' / ')}
                          </span>
                          <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>
                            ({sub.count})
                          </span>
                          {isFrameFolder(folderPath) && (
                            <FramesBadge label={t('tokens.framesFolder')} />
                          )}
                        </button>
                      </SubHeading>
                      {!bulkMode && folderHref && (
                        <Link
                          to={folderHref(folderPath)}
                          style={zipBtnStyle as LinkStyle}
                          aria-label={t('folderNav.open', {
                            folder: subPath.split('/').map(toTitleCase).join(' / '),
                          })}
                        >
                          <LuFolderOpen size={11} aria-hidden="true" /> {t('folderNav.openShort')}
                        </Link>
                      )}
                      {editingFolder !== editKey && !bulkMode && !isMobilePhone && (
                        <>
                          <FolderTagRow
                            tags={tags}
                            editing={false}
                            canTag={canTag}
                            i18n={i18n}
                            onEdit={() => onSetEditingFolder(editKey)}
                            onSave={(newTags) => onSaveFolderTags(folderPath, newTags)}
                            onCancel={() => onSetEditingFolder(null)}
                          />
                          {isAudio && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                playFolder([sub.path])
                              }}
                              style={zipBtnStyle}
                              title={t('audio.playFolder', { folder: subPath })}
                              aria-label={t('audio.playFolder', { folder: subPath })}
                            >
                              <LuPlay size={11} /> {t('audio.player.play')}
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onDownload?.({
                                title: archiveTitle(
                                  `${name} / ${subPath.split('/').map(toTitleCase).join(' / ')}`
                                ),
                                params: { type: archiveType, folder: `${folder}/${subPath}` },
                              })
                            }}
                            style={zipBtnStyle}
                            title={t(`${i18n}.downloadInSubfolder`, { folder: subPath })}
                            aria-label={t(`${i18n}.downloadInSubfolder`, { folder: subPath })}
                          >
                            <LuDownload size={11} /> {t(`${i18n}.download`)}
                          </button>
                          {canTag && <RescanButton scope={`${i18n}/${folder}/${subPath}`} />}
                        </>
                      )}
                      {editingFolder === editKey && !isMobilePhone && (
                        <FolderTagRow
                          tags={tags}
                          editing
                          canTag={canTag}
                          i18n={i18n}
                          resourceType={type}
                          onSave={(newTags) => onSaveFolderTags(folderPath, newTags)}
                          onCancel={() => onSetEditingFolder(null)}
                        />
                      )}
                    </div>
                    {/* Tags row (mobile only) */}
                    {isMobilePhone && !bulkMode && (
                      <div
                        style={{
                          marginTop: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexWrap: 'wrap',
                        }}
                      >
                        <FolderTagRow
                          tags={tags}
                          editing={editingFolder === editKey}
                          canTag={canTag}
                          i18n={i18n}
                          resourceType={type}
                          fullLabels
                          onEdit={() => onSetEditingFolder(editKey)}
                          onSave={(newTags) => onSaveFolderTags(folderPath, newTags)}
                          onCancel={() => onSetEditingFolder(null)}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginBottom: 12 }} />
                )}

                {!isSubCollapsed && (
                  <>
                    <VirtualGrid
                      items={subItems}
                      minColumn={parseInt(config.gridMin[cardSize], 10)}
                      gap={list ? 8 : config.gridGap}
                      list={list}
                      renderItem={(item) => (
                        <MediaCard
                          key={item.id}
                          config={config}
                          item={item}
                          bulkMode={bulkMode}
                          selected={selectedIds?.has(item.id)}
                          onToggle={(mods) => onToggleItem(item.id, mods)}
                          list={list}
                        />
                      )}
                    />
                    {sub.loading && (
                      <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
                        <Spinner size={18} />
                      </div>
                    )}
                    <LoadMoreSentinel
                      active={sub.hasMore && !sub.loading}
                      count={subItems.length}
                      onVisible={() => onLoadFolder(sub.path)}
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
