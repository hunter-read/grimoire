import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'
import ApiKeyPermissionGroup from './ApiKeyPermissionGroup'
import ApiKeyPermissionRow from './ApiKeyPermissionRow'
import type { PermissionRowData } from './ApiKeyPermissionRow'
import { ALL, effectiveLevel, rank } from './apiKeyUtils'

type Permission = Schema<'ApiKeyPermissionOut'>
type PermissionRow = Permission & PermissionRowData

interface PermissionGroup {
  id: string
  rows: PermissionRow[]
  granted: number
}

interface Props {
  permissions: Permission[]
  levels: Record<string, string>
  onChange: (id: string, level: string) => void
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-control)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  fontSize: 14,
}

// A No access / Read / Read and Write level per permission, plus an All
// permissions level that sets a floor for every area, including ones added in
// later versions. Used by the key editor and by the MCP consent page.
//
// Permissions are listed in collapsible groups (the server says which), with a
// filter box above them, so the list stays findable as more areas are added.
export default function ApiKeyPermissionPicker({ permissions, levels, onChange }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  // Groups start open where an area is set on its own, so an edit shows what it
  // picked out; a new key starts with everything folded. A level that comes only
  // from All permissions leaves its group folded - otherwise All = Read (the
  // MCP consent page's default) opens every group - and the group's header
  // still counts what it reaches.
  const [openGroups, setOpenGroups] = useState(
    () => new Set(permissions.filter((perm) => rank(levels[perm.id]) > 0).map((perm) => perm.group))
  )

  const floor = levels[ALL] || 'none'
  const allRow = {
    id: ALL,
    label: t('appSettings.apiKeys.permissions.all.label'),
    description: t('appSettings.apiKeys.permissions.all.description'),
    levels: ['none', 'read', 'write'],
    emphasis: true,
  }
  const rows: PermissionRow[] = permissions.map((perm) => ({
    ...perm,
    label: t(`appSettings.apiKeys.permissions.${perm.id}.label`, perm.id),
    description: t(`appSettings.apiKeys.permissions.${perm.id}.description`, perm.description),
  }))

  // Group in the order the server lists permissions (it lists them group by
  // group), so a new group appears without a client change.
  const needle = query.trim().toLowerCase()
  const matches = (row: PermissionRow) =>
    !needle || `${row.label} ${row.description} ${row.id}`.toLowerCase().includes(needle)
  const groups: PermissionGroup[] = []
  for (const row of rows) {
    const id = row.group || 'other'
    let group = groups.find((g) => g.id === id)
    if (!group) {
      group = { id, rows: [], granted: 0 }
      groups.push(group)
    }
    group.rows.push(row)
    if (rank(effectiveLevel(levels, row)) > 0) group.granted += 1
  }
  const visibleGroups = groups
    .map((g) => ({ ...g, shown: g.rows.filter(matches) }))
    .filter((g) => g.shown.length > 0)

  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-card)',
          marginBottom: 12,
        }}
      >
        <ApiKeyPermissionRow
          perm={allRow}
          value={floor}
          floor="none"
          covered={false}
          onChange={onChange}
          first
        />
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('appSettings.apiKeys.dialog.filter')}
        aria-label={t('appSettings.apiKeys.dialog.filter')}
        style={{ ...inputStyle, marginBottom: 10 }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {visibleGroups.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '8px 0' }}>
            {t('appSettings.apiKeys.dialog.noMatches', { query: query.trim() })}
          </p>
        )}
        {visibleGroups.map((group) => (
          <ApiKeyPermissionGroup
            key={group.id}
            id={group.id}
            // A filter opens every group with a match, so results are never
            // hidden behind a closed header.
            open={Boolean(needle) || openGroups.has(group.id)}
            onToggle={toggleGroup}
            granted={group.granted}
            total={group.rows.length}
          >
            {group.shown.map((perm, i) => (
              <ApiKeyPermissionRow
                key={perm.id}
                perm={perm}
                value={effectiveLevel(levels, perm)}
                floor={floor}
                // Nothing left to raise once All permissions already reaches
                // this area's highest level.
                covered={rank(floor) >= rank(perm.levels[perm.levels.length - 1])}
                onChange={onChange}
                first={i === 0}
              />
            ))}
          </ApiKeyPermissionGroup>
        ))}
      </div>
    </>
  )
}
