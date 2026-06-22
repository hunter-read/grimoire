import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuBookOpen, LuTrash2 } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import ResourceGroup from './ResourceGroup'
import {
  TYPE_ICON,
  resourceKey,
  RESOURCE_TYPES,
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

/** Step in the campaign editor for browsing and selecting library resources. */
export default function ResourcePickerStep({ systemId, selected, setSelected }) {
  const { t } = useTranslation()
  // All available resources (loaded once), grouped client-side by folder/category.
  const [all, setAll] = useState(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [openGroups, setOpenGroups] = useState(() => new Set())

  // Load the campaign system's books plus every map and token, once. Empty query
  // returns the full set per type; we group and filter locally for a snappy,
  // folder-style browser without per-keystroke requests.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      campaigns.searchResources('', 'book', systemId || '', 1000),
      campaigns.searchResources('', 'map', '', 1000),
      campaigns.searchResources('', 'token', '', 1000),
    ])
      .then(([books, maps, tokens]) => {
        if (cancelled) return
        setAll([...(books || []), ...(maps || []), ...(tokens || [])])
      })
      .catch(() => !cancelled && setAll([]))
    return () => {
      cancelled = true
    }
  }, [systemId])

  // Pre-select core books for the campaign's system the first time resources load.
  useEffect(() => {
    if (!all || !systemId) return
    setSelected((prev) => {
      if (prev.length > 0) return prev
      return all
        .filter((r) => r.resource_type === 'book' && r.subtitle === 'core')
        .map((r) => ({
          resource_type: r.resource_type,
          resource_id: r.resource_id,
          name: r.name,
          visibility: 'public',
        }))
    })
  }, [all, systemId, setSelected])

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

  // Filter by type tab + search, then group by resource_type + subtitle (the
  // book category or the map/token folder path).
  const groups = []
  if (all) {
    const byKey = new Map()
    for (const r of all) {
      if (typeFilter && r.resource_type !== typeFilter) continue
      if (q && !r.name.toLowerCase().includes(q) && !(r.subtitle || '').toLowerCase().includes(q))
        continue
      const folder = r.subtitle || t('campaignEditor.resources.ungrouped')
      const groupKey = `${r.resource_type}:::${folder}`
      if (!byKey.has(groupKey)) {
        byKey.set(groupKey, {
          groupKey,
          type: r.resource_type,
          label: folder,
          Icon: TYPE_ICON[r.resource_type] || LuBookOpen,
          rows: [],
        })
      }
      byKey.get(groupKey).rows.push(r)
    }
    // Books first, then maps, then tokens; folders alphabetical within a type.
    const order = { book: 0, map: 1, token: 2 }
    groups.push(
      ...[...byKey.values()].sort(
        (a, b) => order[a.type] - order[b.type] || a.label.localeCompare(b.label)
      )
    )
  }

  // While searching, expand every matching group so hits are visible.
  const isOpen = (key) => (q ? true : openGroups.has(key))
  const toggleGroup = (key) =>
    setOpenGroups((prev) => {
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
        {RESOURCE_TYPES.map((type) => (
          <button
            key={type || 'all'}
            type="button"
            onClick={() => setTypeFilter(type)}
            style={typeTab(typeFilter === type)}
          >
            {t(`campaignEditor.resources.type_${type || 'all'}`)}
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

      {/* Folder browser */}
      <div style={browserBox}>
        {all === null ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spinner size={18} />
          </div>
        ) : groups.length === 0 ? (
          <div style={resultEmpty}>{t('common.noResults')}</div>
        ) : (
          groups.map((g) => (
            <ResourceGroup
              key={g.groupKey}
              groupKey={g.groupKey}
              label={g.label}
              Icon={g.Icon}
              rows={g.rows}
              open={isOpen(g.groupKey)}
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
              const Icon = TYPE_ICON[r.resource_type] || LuBookOpen
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
