import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuBookOpen,
  LuPlus,
  LuChevronRight,
  LuChevronDown,
  LuFolder,
  LuFolderCog,
  LuUpload,
  LuPlay,
} from 'react-icons/lu'
import { campaigns } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useUISettings } from '../../context/UISettingsContext'
import { useAudioPlayer } from '../../context/AudioPlayerContext'
import Spinner from '../Spinner'
import CategoryManager from './CategoryManager'
import { CampaignIcon } from './campaignIcons'
import ResourceRow from './ResourceRow'
import ResourcePickerModal from './ResourcePickerModal'
import { TYPE_ICONS } from './resourcesShared'

export default function ResourcesPanel({ campaign, isOwner, onRefresh }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const ui = useUISettings()
  const { playQueue } = useAudioPlayer()
  const isGmCampaign = campaign.is_gm_campaign

  const TYPE_LABELS = {
    book: t('resources.books'),
    map: t('resources.maps'),
    token: t('resources.tokens'),
    audio: t('resources.audio'),
    file: t('resources.files'),
  }

  const [resources, setResources] = useState(null)
  const [categories, setCategories] = useState([])
  // Local copy of the saved group order, so reordering reflects instantly without
  // waiting on a full campaign reload. Re-synced when the campaign prop changes.
  const [groupOrder, setGroupOrder] = useState(campaign.resource_group_order || [])
  const [adding, setAdding] = useState(false)
  const [managingCats, setManagingCats] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)
  const dragId = useRef(null)

  // Which group sections are collapsed, persisted per campaign so the choice
  // survives navigation. Keyed by group key (category id or built-in type).
  const collapseKey = `grimoire_resource_collapsed_${campaign.id}`
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(collapseKey) || '[]'))
    } catch {
      return new Set()
    }
  })
  const toggleCollapse = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      try {
        localStorage.setItem(collapseKey, JSON.stringify([...next]))
      } catch {
        // localStorage unavailable (private mode); collapse state stays in memory only.
      }
      return next
    })
  }

  const load = () => {
    campaigns
      .listResources(campaign.id)
      .then(setResources)
      .catch(() => setResources([]))
  }
  const loadCategories = () => {
    campaigns
      .listCategories(campaign.id, 'resource')
      .then(setCategories)
      .catch(() => setCategories([]))
  }

  useEffect(() => {
    load()
    loadCategories()
  }, [campaign.id])

  useEffect(() => {
    setGroupOrder(campaign.resource_group_order || [])
  }, [campaign.resource_group_order])

  const members = (campaign.members || []).filter((m) => !m.is_owner)

  const remove = async (resource) => {
    if (resource.resource_type === 'file' && !confirm(t('resources.deleteFileConfirm'))) return
    await campaigns.removeResource(campaign.id, resource.id)
    load()
  }

  const setVisibility = async (resourceId, visibility) => {
    await campaigns.updateResource(campaign.id, resourceId, { visibility })
    load()
  }
  const setShares = async (resourceId, ids) => {
    await campaigns.updateResource(campaign.id, resourceId, { shared_user_ids: ids })
    load()
  }
  const setCategory = async (resourceId, categoryId) => {
    await campaigns.updateResource(campaign.id, resourceId, { category_id: categoryId || '' })
    load()
  }

  const uploadDisabled = ui.campaign_uploads_disabled && user?.role !== 'admin'

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      await campaigns.uploadFile(campaign.id, file)
      load()
    } catch (err) {
      alert(err.message)
    } finally {
      setUploading(false)
    }
  }

  // --- Drag and drop (owner only) ---
  const onDragStart = (e, resource) => {
    dragId.current = resource.id
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDropToGroup = async (group) => {
    const id = dragId.current
    dragId.current = null
    if (!id) return
    // Dropping onto a custom category sets category_id; onto a type group clears it.
    const target = group.custom ? group.catId : ''
    const res = resources.find((r) => r.id === id)
    if (res && (res.category_id || '') !== target) {
      await setCategory(id, target)
    }
  }
  const onDropOnResource = async (e, target) => {
    e.preventDefault()
    e.stopPropagation()
    const id = dragId.current
    dragId.current = null
    if (!id || id === target.id) return
    // Reorder: place dragged before target, and adopt target's category.
    const dragged = resources.find((r) => r.id === id)
    if (dragged && (dragged.category_id || '') !== (target.category_id || '')) {
      await campaigns.updateResource(campaign.id, id, { category_id: target.category_id || '' })
    }
    const ids = resources.map((r) => r.id).filter((x) => x !== id)
    const idx = ids.indexOf(target.id)
    ids.splice(idx, 0, id)
    await campaigns.reorderResources(campaign.id, ids)
    load()
  }

  if (!resources)
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spinner size={24} />
      </div>
    )

  const linkedIds = new Set(resources.map((r) => `${r.resource_type}:${r.resource_id}`))
  const catById = new Map(categories.map((c) => [c.id, c]))

  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
  const groups = []
  for (const cat of sortedCats) {
    const items = resources.filter((r) => r.category_id === cat.id)
    groups.push({
      key: `cat:${cat.id}`,
      catId: cat.id,
      label: cat.name,
      custom: true,
      icon: cat.icon,
      items,
    })
  }
  for (const type of Object.keys(TYPE_ICONS)) {
    const items = resources.filter(
      (r) => r.resource_type === type && (!r.category_id || !catById.has(r.category_id))
    )
    groups.push({ key: `type:${type}`, label: TYPE_LABELS[type], type, items })
  }
  // Apply the GM's saved group order; groups not listed keep their default
  // relative order at the end. A type group with no items is hidden unless the GM
  // has explicitly placed it (so an empty Books group can still be reordered).
  const order = groupOrder || []
  const orderIndex = (key) => {
    const i = order.indexOf(key)
    return i === -1 ? order.length + groups.findIndex((g) => g.key === key) : i
  }
  groups.sort((a, b) => orderIndex(a.key) - orderIndex(b.key))
  const orderedSet = new Set(order)
  const visibleGroups = groups.filter(
    (g) => g.items.length > 0 || g.custom || orderedSet.has(g.key)
  )

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <h3
          style={{
            fontSize: 15,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <LuBookOpen size={15} /> {t('resources.title')}
        </h3>
        {isOwner && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setManagingCats(true)} style={panelHeaderBtn}>
              <LuFolderCog size={14} /> {t('resources.manageCategories')}
            </button>
            {!uploadDisabled && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={panelHeaderBtn}
              >
                <LuUpload size={14} />{' '}
                {uploading ? t('resources.uploading') : t('resources.uploadFile')}
              </button>
            )}
            <button onClick={() => setAdding(true)} style={panelHeaderBtn}>
              <LuPlus size={14} /> {t('resources.linkResource')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFile}
              style={{ display: 'none' }}
            />
          </div>
        )}
      </div>

      {adding && isOwner && (
        <ResourcePickerModal
          campaignId={campaign.id}
          pinSystem={campaign.system_display_name}
          linkedKeys={linkedIds}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            load()
          }}
        />
      )}

      {resources.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          <LuBookOpen size={28} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>{t('resources.noResources')}</div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 20,
            alignItems: 'start',
          }}
        >
          {visibleGroups.map((g) => {
            const TypeIcon = g.type ? TYPE_ICONS[g.type].Icon : LuFolder
            const isCollapsed = collapsed.has(g.key)
            // Audio resources in this group, for the GM-only group play button.
            const audioItems = g.items.filter((r) => r.resource_type === 'audio')
            return (
              <section
                key={g.key}
                onDragOver={isOwner ? (e) => e.preventDefault() : undefined}
                onDrop={isOwner ? () => onDropToGroup(g) : undefined}
                style={{ marginBottom: 4 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => toggleCollapse(g.key)}
                    aria-expanded={!isCollapsed}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      textAlign: 'left',
                      font: 'inherit',
                    }}
                  >
                    {isCollapsed ? (
                      <LuChevronRight size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
                    ) : (
                      <LuChevronDown size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
                    )}
                    <CampaignIcon name={g.icon} fallback={TypeIcon} size={12} /> {g.label} (
                    {g.items.length})
                  </button>
                  {isOwner && audioItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        playQueue(
                          audioItems.map((r) => ({
                            id: r.resource_id,
                            title: r.name,
                            artwork: r.has_thumbnail,
                          }))
                        )
                      }
                      title={t('audio.playGroup')}
                      aria-label={t('audio.playGroup')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        flexShrink: 0,
                        padding: '2px 8px',
                        borderRadius: 5,
                        fontSize: 11,
                        color: 'var(--text-dim)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-deep)',
                        cursor: 'pointer',
                      }}
                    >
                      <LuPlay size={11} /> {t('audio.player.play')}
                    </button>
                  )}
                </div>
                {isCollapsed ? null : g.items.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      fontStyle: 'italic',
                      padding: '8px 12px',
                      border: '1px dashed var(--border)',
                      borderRadius: 8,
                    }}
                  >
                    {t('resources.emptyCategory')}
                  </div>
                ) : (
                  g.items.map((r) => (
                    <div
                      key={r.id}
                      onDragOver={isOwner ? (e) => e.preventDefault() : undefined}
                      onDrop={isOwner ? (e) => onDropOnResource(e, r) : undefined}
                    >
                      <ResourceRow
                        campaignId={campaign.id}
                        resource={r}
                        isOwner={isOwner}
                        isGmCampaign={isGmCampaign}
                        members={members}
                        categories={categories}
                        onRemove={remove}
                        onSetVisibility={setVisibility}
                        onSetShares={setShares}
                        onSetCategory={setCategory}
                        onDragStart={onDragStart}
                      />
                    </div>
                  ))
                )}
              </section>
            )
          })}
        </div>
      )}

      {managingCats && (
        <CategoryManager
          campaignId={campaign.id}
          kind="resource"
          typeGroups={Object.keys(TYPE_ICONS).map((type) => ({
            key: `type:${type}`,
            label: TYPE_LABELS[type],
          }))}
          groupOrder={groupOrder}
          onGroupOrderChange={(next) => setGroupOrder(next)}
          onClose={() => setManagingCats(false)}
          onChanged={() => {
            loadCategories()
            load()
            onRefresh?.()
          }}
        />
      )}
    </div>
  )
}

const panelHeaderBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 13,
}
