import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFolder, LuChevronDown, LuChevronRight, LuTag, LuCheck, LuMinus, LuDownload } from 'react-icons/lu'
import TokenCard from './TokenCard'
import InlineTagEditor from '../maps/InlineTagEditor'
import LazyGrid from '../LazyGrid'
import { toTitleCase } from '../../utils'

function FolderCheckbox({ checked, indeterminate, onChange }) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onChange() }}
      style={{
        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
        background: checked || indeterminate ? 'var(--gold)' : 'rgba(0,0,0,0.4)',
        border: checked || indeterminate ? 'none' : '2px solid rgba(255,255,255,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}
    >
      {checked && <LuCheck size={11} color="var(--bg-deep)" strokeWidth={3} />}
      {indeterminate && !checked && <LuMinus size={11} color="var(--bg-deep)" strokeWidth={3} />}
    </div>
  )
}

const isMobilePhone = window.matchMedia('(max-width: 640px)').matches

export default function TokenFolderGroup({ folder, subfolders, collapsed, onToggle, folderTags, editingFolder, onSetEditingFolder, onSaveFolderTags, onSelectToken, bulkMode, selectedTokenIds, selectedFolderPaths, onToggleToken, onToggleFolder, cardSize = 'comfortable', canTag = true, onDownload }) {
  const { t } = useTranslation()
  const isCollapsed = collapsed.has(folder)
  const allTokensInGroup = Object.values(subfolders).flat()
  const totalTokens = allTokensInGroup.length

  const groupFolderChecked = selectedFolderPaths.has(folder) && allTokensInGroup.every(tok => selectedTokenIds.has(tok.id))
  const groupFolderIndeterminate = !groupFolderChecked && (
    selectedFolderPaths.has(folder) || allTokensInGroup.some(tok => selectedTokenIds.has(tok.id))
  )

  const [editingRoot, setEditingRoot] = useState(false)
  const topLevelTags = folderTags[folder] ?? []

  const subfolderEntries = Object.entries(subfolders).sort(([a], [b]) => {
    if (a === '') return 1
    if (b === '') return -1
    return a.localeCompare(b)
  })

  return (
    <div style={{ marginBottom: 16, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{
        padding: '12px 20px',
        background: 'var(--bg-panel)',
        borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
      }}>
        {/* Top row: chevron + icon + name + dot leader + count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {bulkMode && (
            <FolderCheckbox
              checked={groupFolderChecked}
              indeterminate={groupFolderIndeterminate}
              onChange={() => onToggleFolder(folder, allTokensInGroup)}
            />
          )}
          <button
            onClick={() => onToggle(folder)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? t('tokens.expandFolder', { folder }) : t('tokens.collapseFolder', { folder })}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0, flex: 1, minWidth: 0, overflow: 'hidden' }}
          >
            {isCollapsed
              ? <LuChevronRight size={16} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
              : <LuChevronDown size={16} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
            }
            <LuFolder size={16} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 18, color: 'var(--gold-dim)', fontFamily: 'Cinzel, serif', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {toTitleCase(folder)}
            </span>
            {!isMobilePhone && <span style={{ flex: 1, borderBottom: '1px dotted var(--border)', margin: '0 8px', minWidth: 16 }} />}
          </button>
          <span style={{ fontSize: 14, color: 'var(--text-muted)', flexShrink: 0 }}>
            {t('tokens.tokenCount', { count: totalTokens })}
          </span>
          {!bulkMode && (
            <button
              onClick={e => { e.stopPropagation(); onDownload?.({ title: `Tokens — ${toTitleCase(folder)}`, params: { type: 'token_folder', folder } }) }}
              style={zipBtnStyle}
              title={t('tokens.downloadAllInFolder', { folder })}
            >
              <LuDownload size={11} /> {t('tokens.download')}
            </button>
          )}
        </div>

        {/* Tags row (desktop only — mobile shows tags below when expanded) */}
        {!bulkMode && !isMobilePhone && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 8, paddingLeft: 52 }}>
            {editingRoot ? (
              <InlineTagEditor
                tags={topLevelTags}
                onSave={(newTags) => onSaveFolderTags(folder, newTags)}
                onCancel={() => setEditingRoot(false)}
              />
            ) : (
              <>
                {topLevelTags.map(tag => <span key={tag} style={tagPillStyle}>{tag.charAt(0).toUpperCase() + tag.slice(1)}</span>)}
                {canTag && (
                  <button
                    onClick={() => setEditingRoot(true)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, padding: '2px 6px' }}
                  >
                    <LuTag size={11} /> {topLevelTags.length > 0 ? t('tokens.editTags') : t('tokens.addTags')}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {isMobilePhone && !bulkMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {editingRoot ? (
                <InlineTagEditor
                  tags={topLevelTags}
                  onSave={(newTags) => onSaveFolderTags(folder, newTags)}
                  onCancel={() => setEditingRoot(false)}
                />
              ) : (
                <>
                  {topLevelTags.map(tag => <span key={tag} style={tagPillStyle}>{tag.charAt(0).toUpperCase() + tag.slice(1)}</span>)}
                  {canTag && (
                    <button
                      onClick={() => setEditingRoot(true)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, padding: '2px 6px' }}
                    >
                      <LuTag size={11} /> {topLevelTags.length > 0 ? t('tokens.editTagsFull') : t('tokens.addTags')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {subfolderEntries.map(([subPath, subTokens]) => {
            const folderPath = subPath ? `${folder}/${subPath}` : folder
            const tags = folderTags[folderPath] ?? []
            const editKey = `${folder}::${subPath}`
            const isSubCollapsed = subPath ? collapsed.has(editKey) : false

            const subChecked = subPath && selectedFolderPaths.has(folderPath) && subTokens.every(tok => selectedTokenIds.has(tok.id))
            const subIndeterminate = subPath && !subChecked && (
              selectedFolderPaths.has(folderPath) || subTokens.some(tok => selectedTokenIds.has(tok.id))
            )

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
                          onChange={() => onToggleFolder(folderPath, subTokens)}
                        />
                      )}
                      <button
                        onClick={() => onToggle(editKey)}
                        aria-expanded={!isSubCollapsed}
                        aria-label={isSubCollapsed ? t('tokens.expandFolder', { folder: subPath }) : t('tokens.collapseFolder', { folder: subPath })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}
                      >
                        {isSubCollapsed
                          ? <LuChevronRight size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                          : <LuChevronDown size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        }
                        <LuFolder size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 15, color: 'var(--text-dim)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {subPath.split('/').map(toTitleCase).join(' / ')}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>({subTokens.length})</span>
                      </button>
                      {editingFolder !== editKey && !bulkMode && !isMobilePhone && (
                        <>
                          {tags.map(tag => <span key={tag} style={tagPillStyle}>{tag.charAt(0).toUpperCase() + tag.slice(1)}</span>)}
                          {canTag && (
                            <button
                              onClick={() => onSetEditingFolder(editKey)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, padding: '2px 6px' }}
                            >
                              <LuTag size={11} /> {tags.length > 0 ? t('tokens.editTags') : t('tokens.addTags')}
                            </button>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); onDownload?.({ title: `Tokens — ${toTitleCase(folder)} / ${subPath.split('/').map(toTitleCase).join(' / ')}`, params: { type: 'token_folder', folder: `${folder}/${subPath}` } }) }}
                            style={zipBtnStyle}
                            title={t('tokens.downloadInSubfolder', { folder: subPath })}
                          >
                            <LuDownload size={11} /> {t('tokens.download')}
                          </button>
                        </>
                      )}
                      {editingFolder === editKey && !isMobilePhone && (
                        <InlineTagEditor
                          tags={tags}
                          onSave={(newTags) => onSaveFolderTags(folderPath, newTags)}
                          onCancel={() => onSetEditingFolder(null)}
                        />
                      )}
                    </div>
                    {/* Tags row (mobile only) */}
                    {isMobilePhone && !bulkMode && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {editingFolder === editKey ? (
                          <InlineTagEditor
                            tags={tags}
                            onSave={(newTags) => onSaveFolderTags(folderPath, newTags)}
                            onCancel={() => onSetEditingFolder(null)}
                          />
                        ) : (
                          <>
                            {tags.map(tag => <span key={tag} style={tagPillStyle}>{tag.charAt(0).toUpperCase() + tag.slice(1)}</span>)}
                            {canTag && (
                              <button
                                onClick={() => onSetEditingFolder(editKey)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, padding: '2px 6px' }}
                              >
                                <LuTag size={11} /> {tags.length > 0 ? t('tokens.editTagsFull') : t('tokens.addTags')}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginBottom: 12 }} />
                )}

                {!isSubCollapsed && (
                  <LazyGrid count={subTokens.length} cardSize={cardSize}>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize === 'compact' ? '90px' : '130px'}, 1fr))`, gap: 12 }}>
                      {subTokens.map(tok => (
                        <TokenCard
                          key={tok.id}
                          token={tok}
                          onClick={() => onSelectToken(tok.id)}
                          bulkMode={bulkMode}
                          selected={selectedTokenIds?.has(tok.id)}
                          onToggle={() => onToggleToken(tok.id)}
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

const tagPillStyle = {
  fontSize: 12, padding: '2px 8px', borderRadius: 10,
  background: 'var(--tag-bg)', border: '1px solid var(--tag-border)', color: 'var(--text-dim)',
}

const zipBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '2px 7px', borderRadius: 5, fontSize: 12, flexShrink: 0,
  color: 'var(--text-muted)', border: '1px solid var(--border)',
  background: 'var(--bg-card)', cursor: 'pointer',
}
