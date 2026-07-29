import { useState } from 'react'
import { LuChevronDown } from 'react-icons/lu'
import { getDefaultViewMode } from '../../hooks/useViewMode'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'
import { gridStyle, ROW_LIST_STYLE } from '../favorites/favoriteStyles'
import TagFolderGroup from './TagFolderGroup'

const PREFS_KEY = 'tagsSectionCollapsed'

/**
 * One collapsible section on the tags detail pane for a single resource type
 * (Maps/Tokens/Audio/…): its directly-tagged items first, then each folder-tag
 * group nested beneath — so map/token/audio folders live under their main type
 * heading. Collapse state persists per type in user prefs.
 */
export default function TagTypeSection({ type, title, items, folders, renderItem }) {
  const [collapsed, setCollapsed] = useState(() => Boolean(getUserPrefs()[PREFS_KEY]?.[type]))
  const mode = getDefaultViewMode(type)
  const grid = mode !== 'list'
  const containerStyle = grid ? gridStyle(mode) : ROW_LIST_STYLE

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    const prev = getUserPrefs()[PREFS_KEY] || {}
    saveUserPref(PREFS_KEY, { ...prev, [type]: next })
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          marginBottom: 12,
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: 14,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        <LuChevronDown
          size={16}
          aria-hidden="true"
          style={{
            transition: 'transform 0.15s',
            transform: collapsed ? 'rotate(-90deg)' : 'none',
            flexShrink: 0,
          }}
        />
        {title}
      </button>
      {!collapsed && (
        <>
          {items.length > 0 && (
            <div style={containerStyle}>{items.map((item) => renderItem(item, grid))}</div>
          )}
          {folders.map((g) => (
            <TagFolderGroup
              key={`${g.resource_type}:${g.path}`}
              resourceType={g.resource_type}
              path={g.path}
              items={g.items}
              containerStyle={containerStyle}
              renderItem={(item) => renderItem(item, grid)}
            />
          ))}
        </>
      )}
    </section>
  )
}
