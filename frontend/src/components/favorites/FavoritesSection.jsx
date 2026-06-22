import { useState } from 'react'
import { LuChevronDown } from 'react-icons/lu'
import { getDefaultViewMode } from '../../hooks/useViewMode'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'
import { gridStyle, ROW_LIST_STYLE } from './favoriteStyles'

const PREFS_KEY = 'favoritesCollapsed'

/**
 * A favorites section with a collapsible header. Items render using the user's
 * preferred view style for the section's content type (card/compact → grid,
 * list → rows). Collapse state persists per content type in user prefs.
 */
export default function FavoritesSection({ type, title, items, renderItem }) {
  const [collapsed, setCollapsed] = useState(() => Boolean(getUserPrefs()[PREFS_KEY]?.[type]))
  const mode = getDefaultViewMode(type)
  const grid = mode !== 'list'

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
        <div style={grid ? gridStyle(mode) : ROW_LIST_STYLE}>
          {items.map((item) => renderItem(item, grid))}
        </div>
      )}
    </section>
  )
}
