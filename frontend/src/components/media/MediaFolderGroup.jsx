import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFolder, LuChevronDown, LuChevronRight, LuDownload } from 'react-icons/lu'
import MediaCard from './MediaCard'
import FolderTagRow from './FolderTagRow'
import FolderCheckbox from '../FolderCheckbox'
import LazyGrid from '../LazyGrid'
import { toTitleCase } from '../../utils'

const isMobilePhone = window.matchMedia('(max-width: 640px)').matches

const zipBtnStyle = {
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

/**
 * Renders a top-level folder group and its subfolders for a media gallery.
 * Type-specific concerns (icon, grid sizing, endpoints, i18n keys) come from
 * `config` (see mediaConfig.js), so a single component serves maps, tokens, etc.
 */
export default function MediaFolderGroup({
  config,
  folder,
  subfolders,
  collapsed,
  onToggle,
  folderTags,
  editingFolder,
  onSetEditingFolder,
  onSaveFolderTags,
  onSelectItem,
  bulkMode,
  selectedIds,
  selectedFolderPaths,
  onToggleItem,
  onToggleFolder,
  cardSize = 'comfortable',
  list = false,
  canTag = true,
  onDownload,
}) {
  const { t } = useTranslation()
  const { i18n, archiveType, countKey } = config
  const [editingRoot, setEditingRoot] = useState(false)
  const isCollapsed = collapsed.has(folder)
  const allInGroup = Object.values(subfolders).flat()
  const total = allInGroup.length
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

  const archiveTitle = (suffix) => toTitleCase(i18n) + ' — ' + suffix

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {bulkMode && (
            <FolderCheckbox
              checked={groupFolderChecked}
              indeterminate={groupFolderIndeterminate}
              onChange={() => onToggleFolder(folder, allInGroup)}
            />
          )}
          <button
            onClick={() => onToggle(folder)}
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? t(`${i18n}.expandFolder`, { folder })
                : t(`${i18n}.collapseFolder`, { folder })
            }
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
              {toTitleCase(folder)}
            </span>
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
          {!bulkMode && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDownload?.({
                  title: archiveTitle(toTitleCase(folder)),
                  params: { type: archiveType, folder },
                })
              }}
              style={zipBtnStyle}
              title={t(`${i18n}.downloadAllInFolder`, { folder })}
            >
              <LuDownload size={11} /> {t(`${i18n}.download`)}
            </button>
          )}
        </div>

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
                fullLabels
                onEdit={() => setEditingRoot(true)}
                onSave={(newTags) => onSaveFolderTags(folder, newTags)}
                onCancel={() => setEditingRoot(false)}
              />
            </div>
          )}
          {subfolderEntries.map(([subPath, subItems]) => {
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
                          checked={subChecked}
                          indeterminate={subIndeterminate}
                          onChange={() => onToggleFolder(folderPath, subItems)}
                        />
                      )}
                      <button
                        onClick={() => onToggle(editKey)}
                        aria-expanded={!isSubCollapsed}
                        aria-label={
                          isSubCollapsed
                            ? t(`${i18n}.expandFolder`, { folder: subPath })
                            : t(`${i18n}.collapseFolder`, { folder: subPath })
                        }
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
                          ({subItems.length})
                        </span>
                      </button>
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
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onDownload?.({
                                title: archiveTitle(
                                  `${toTitleCase(folder)} / ${subPath
                                    .split('/')
                                    .map(toTitleCase)
                                    .join(' / ')}`
                                ),
                                params: { type: archiveType, folder: `${folder}/${subPath}` },
                              })
                            }}
                            style={zipBtnStyle}
                            title={t(`${i18n}.downloadInSubfolder`, { folder: subPath })}
                          >
                            <LuDownload size={11} /> {t(`${i18n}.download`)}
                          </button>
                        </>
                      )}
                      {editingFolder === editKey && !isMobilePhone && (
                        <FolderTagRow
                          tags={tags}
                          editing
                          canTag={canTag}
                          i18n={i18n}
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
                  <LazyGrid count={subItems.length} cardSize={cardSize} list={list}>
                    <div
                      style={
                        list
                          ? { display: 'flex', flexDirection: 'column', gap: 8 }
                          : {
                              display: 'grid',
                              gridTemplateColumns: `repeat(auto-fill, minmax(${config.gridMin[cardSize]}, 1fr))`,
                              gap: config.gridGap,
                            }
                      }
                    >
                      {subItems.map((item) => (
                        <MediaCard
                          key={item.id}
                          config={config}
                          item={item}
                          onClick={() => onSelectItem(item.id)}
                          bulkMode={bulkMode}
                          selected={selectedIds?.has(item.id)}
                          onToggle={(mods) => onToggleItem(item.id, mods)}
                          list={list}
                        />
                      ))}
                    </div>
                  </LazyGrid>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
