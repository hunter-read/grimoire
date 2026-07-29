import { useState } from 'react'
import { LuChevronDown, LuFolder } from 'react-icons/lu'
import { getUserPrefs, saveUserPref } from '../../hooks/useUserPrefs'
import { toTitleCase } from '../../utils'

const PREFS_KEY = 'tagsFolderCollapsed'

/** Folder paths titled like the media pages: each segment Title-Cased. */
const folderTitle = (path) => path.split('/').map(toTitleCase).join(' / ')

/**
 * One collapsible folder-tag group inside a TagTypeSection: a folder header
 * (chevron + name) over the folder's items. Collapse state persists per
 * folder key ("{resource_type}:{path}") in user prefs, so each folder toggles
 * independently and remembers its state.
 */
export default function TagFolderGroup({ resourceType, path, items, containerStyle, renderItem }) {
  const key = `${resourceType}:${path}`
  const [collapsed, setCollapsed] = useState(() => Boolean(getUserPrefs()[PREFS_KEY]?.[key]))

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    const prev = getUserPrefs()[PREFS_KEY] || {}
    saveUserPref(PREFS_KEY, { ...prev, [key]: next })
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          marginBottom: 10,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-dim)',
          textAlign: 'left',
        }}
      >
        <LuChevronDown
          size={14}
          aria-hidden="true"
          style={{
            transition: 'transform 0.15s',
            transform: collapsed ? 'rotate(-90deg)' : 'none',
            flexShrink: 0,
          }}
        />
        <LuFolder size={14} color="var(--gold-dim)" style={{ flexShrink: 0 }} />
        {folderTitle(path)}
      </button>
      {!collapsed && <div style={containerStyle}>{items.map((item) => renderItem(item))}</div>}
    </div>
  )
}
