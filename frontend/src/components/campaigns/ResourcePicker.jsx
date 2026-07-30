import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuBookOpen, LuTrash2, LuTags } from 'react-icons/lu'
import { campaigns, tags as tagsApi } from '../../api'
import Spinner from '../Spinner'
import ResourceGroup from './ResourceGroup'
import { TYPE_ICONS, PICKER_TYPES, resourceKey, buildFolderTree } from './resourcesShared'
import {
  inputStyle,
  sectionLabel,
  selectedRow,
  visibilitySelect,
  iconBtn,
  resultEmpty,
  ellipsis,
  browserBox,
  typeTab,
} from './campaignEditorShared'

/**
 * Unified library-resource picker: browse books/maps/tokens/audio by folder,
 * check what to include, and set each pick's visibility. The selection is fully
 * controlled by the parent via `selected` / `setSelected`, so the same component
 * drives both the create wizard and the "link more resources" modal.
 *
 * `systemId` scopes the book results to one game system (empty = all systems).
 * `preselectCore` pre-checks that system's core books once, for the wizard.
 * `excludeKeys` is a Set of `resourceKey` values already linked; those rows are
 * filtered out so you can't pick a duplicate.
 * `pinSystem` is the campaign's game-system *name*; when set it floats that
 * system to the top of the book folder tree (the rest stay alphabetical).
 */
export default function ResourcePicker({
  systemId = '',
  selected,
  setSelected,
  preselectCore = false,
  excludeKeys,
  pinSystem = '',
}) {
  const { t } = useTranslation()
  // All available resources (loaded once per type set), grouped client-side.
  const [all, setAll] = useState(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('book')
  const [openKeys, setOpenKeys] = useState(() => new Set())
  // "Add by tag" (issue #235.8): the loaded tag list and any add error.
  const [tagList, setTagList] = useState([])
  const [tagValue, setTagValue] = useState('')
  const [tagAdding, setTagAdding] = useState(false)

  // Load books (optionally scoped to the campaign's system) plus every map,
  // token, and audio item, once. Empty query returns the full set per type; we
  // group and filter locally for a snappy folder browser without per-keystroke
  // requests.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      campaigns.searchResources('', 'book', systemId || '', 1000),
      campaigns.searchResources('', 'map', '', 1000),
      campaigns.searchResources('', 'token', '', 1000),
      campaigns.searchResources('', 'audio', '', 1000),
    ])
      .then(([books, maps, tokens, audio]) => {
        if (cancelled) return
        setAll([...(books || []), ...(maps || []), ...(tokens || []), ...(audio || [])])
      })
      .catch(() => !cancelled && setAll([]))
    return () => {
      cancelled = true
    }
  }, [systemId])

  // Load the tag list once, for the "add by tag" picker.
  useEffect(() => {
    let cancelled = false
    tagsApi
      .list()
      .then((r) => !cancelled && setTagList(r.tags || []))
      .catch(() => !cancelled && setTagList([]))
    return () => {
      cancelled = true
    }
  }, [])

  // Add every campaign-addable resource carrying the chosen tag to the selection
  // (issue #235.8). Systems aren't campaign resources, so they're skipped; rows
  // already selected or excluded are left as-is. Metadata (name) is enriched from
  // the loaded resource set when available.
  const addByTag = async (internal) => {
    if (!internal || tagAdding) return
    setTagAdding(true)
    try {
      const { items } = await tagsApi.items(internal)
      const byKey = new Map((all || []).map((r) => [resourceKey(r), r]))
      setSelected((prev) => {
        const have = new Set(prev.map(resourceKey))
        const additions = []
        for (const it of items || []) {
          if (!PICKER_TYPES.includes(it.item_type)) continue // skip systems
          const key = `${it.item_type}:${it.item_id}`
          if (have.has(key)) continue
          if (excludeKeys && excludeKeys.has(key)) continue
          const meta = byKey.get(key)
          additions.push({
            resource_type: it.item_type,
            resource_id: it.item_id,
            name: meta?.name || it.title || it.filename || it.item_id,
            visibility: 'public',
          })
          have.add(key)
        }
        return additions.length ? [...prev, ...additions] : prev
      })
      setTagValue('')
    } finally {
      setTagAdding(false)
    }
  }

  // Pre-select core books for the campaign's system the first time resources
  // load (wizard only). Skipped once the user has picked anything.
  useEffect(() => {
    if (!preselectCore || !all || !systemId) return
    setSelected((prev) => {
      if (prev.length > 0) return prev
      return all
        .filter(
          (r) =>
            r.resource_type === 'book' &&
            // subtitle is now "<System>/core" (or bare "core"); match the last
            // path segment so the system prefix doesn't break pre-selection.
            (r.subtitle || '').split('/').pop() === 'core'
        )
        .map((r) => ({
          resource_type: r.resource_type,
          resource_id: r.resource_id,
          name: r.name,
          visibility: 'public',
        }))
    })
  }, [all, systemId, preselectCore, setSelected])

  const selectedKeys = new Set(selected.map(resourceKey))

  const toggleRow = (r) => {
    setSelected((prev) => {
      const key = resourceKey(r)
      if (prev.some((s) => resourceKey(s) === key)) {
        return prev.filter((s) => resourceKey(s) !== key)
      }
      return [
        ...prev,
        {
          resource_type: r.resource_type,
          resource_id: r.resource_id,
          name: r.name,
          visibility: 'public',
        },
      ]
    })
  }

  const setVisibility = (r, visibility) =>
    setSelected((prev) =>
      prev.map((s) => (resourceKey(s) === resourceKey(r) ? { ...s, visibility } : s))
    )

  const q = query.trim().toLowerCase()

  // Filter to the active type + search + not-already-linked, then build a
  // nested folder tree from each item's subtitle path.
  const filtered = (all || []).filter((r) => {
    if (r.resource_type !== typeFilter) return false
    if (excludeKeys && excludeKeys.has(resourceKey(r))) return false
    if (q && !r.name.toLowerCase().includes(q) && !(r.subtitle || '').toLowerCase().includes(q))
      return false
    return true
  })
  // Pin the campaign's own system to the top of the book tree only.
  const pin = typeFilter === 'book' ? pinSystem : ''
  const tree = buildFolderTree(filtered, t('campaignEditor.resources.ungrouped'), pin)

  // While searching, expand every folder so matches are visible; otherwise use
  // the user's manual open/close set (folders start collapsed).
  const allKeys = collectKeys(tree)
  const openSet = q ? new Set(allKeys) : openKeys
  const toggleGroup = (key) =>
    setOpenKeys((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
        {t('campaignEditor.resources.intro')}
      </p>

      {/* Type tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {PICKER_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setTypeFilter(type)}
            style={typeTab(typeFilter === type)}
          >
            {t(`campaignEditor.resources.type_${type}`)}
          </button>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <LuSearch
          size={14}
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
          }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('campaignEditor.resources.searchPlaceholder')}
          style={{ ...inputStyle, paddingLeft: 32 }}
        />
      </div>

      {/* Add by tag (issue #235.8) */}
      {tagList.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
          <LuTags size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <select
            aria-label={t('campaignEditor.resources.addByTag')}
            value={tagValue}
            onChange={(e) => setTagValue(e.target.value)}
            style={{ ...inputStyle, appearance: 'auto', flex: 1 }}
          >
            <option value="">{t('campaignEditor.resources.addByTag')}</option>
            {tagList.map((tg) => (
              <option key={tg.internal} value={tg.internal}>
                {tg.display} ({tg.count})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => addByTag(tagValue)}
            disabled={!tagValue || tagAdding}
            style={{ ...typeTab(false), opacity: !tagValue || tagAdding ? 0.5 : 1 }}
          >
            {t('campaignEditor.resources.addByTagButton')}
          </button>
        </div>
      )}

      {/* Folder browser */}
      <div style={browserBox}>
        {all === null ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spinner size={18} />
          </div>
        ) : tree.length === 0 ? (
          <div style={resultEmpty}>{t('common.noResults')}</div>
        ) : (
          tree.map((node) => (
            <ResourceGroup
              key={node.key}
              node={node}
              openKeys={openSet}
              onToggle={toggleGroup}
              selectedKeys={selectedKeys}
              toggleRow={toggleRow}
            />
          ))
        )}
      </div>

      {/* Selected summary with inline visibility */}
      <div style={{ marginTop: 14 }}>
        <div style={sectionLabel}>
          {t('campaignEditor.resources.selectedCount', { count: selected.length })}
        </div>
        {selected.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {selected.map((r) => {
              const { Icon } = TYPE_ICONS[r.resource_type] || { Icon: LuBookOpen }
              return (
                <div key={resourceKey(r)} style={selectedRow}>
                  <Icon size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                  <span style={{ flex: 1, fontSize: 13, ...ellipsis }}>{r.name}</span>
                  <select
                    value={r.visibility}
                    onChange={(e) => setVisibility(r, e.target.value)}
                    aria-label={t('campaignEditor.resources.visibilityLabel')}
                    style={visibilitySelect}
                  >
                    <option value="public">{t('resources.vis_public')}</option>
                    <option value="private">{t('resources.vis_private')}</option>
                    <option value="gm">{t('resources.vis_gm')}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => toggleRow(r)}
                    aria-label={t('common.remove')}
                    style={iconBtn('var(--danger)')}
                  >
                    <LuTrash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** All folder keys in a tree, for the search auto-expand set. */
function collectKeys(nodes) {
  const keys = []
  for (const n of nodes) {
    keys.push(n.key)
    keys.push(...collectKeys(n.folders))
  }
  return keys
}
