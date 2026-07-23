import { LuChevronDown, LuChevronRight, LuFolder } from 'react-icons/lu'
import { resourceKey, nodeResources } from './resourcesShared'
import { resGroup, resGroupHeader, ellipsis, resRow } from './campaignEditorShared'

/**
 * One collapsible folder in the resource picker's folder tree. Renders nested
 * subfolders recursively (arbitrary depth) before its own loose items, so the
 * system → category → subcategory → … structure is browsable in place.
 */
export default function ResourceGroup({
  node,
  depth = 0,
  openKeys,
  onToggle,
  selectedKeys,
  toggleRow,
}) {
  const open = openKeys.has(node.key)
  const contained = nodeResources(node)
  const selectedCount = contained.filter((r) => selectedKeys.has(resourceKey(r))).length
  // Indent nested folders/rows a little further at each level.
  const indent = 10 + depth * 14

  return (
    <div style={resGroup}>
      <button
        type="button"
        onClick={() => onToggle(node.key)}
        style={{ ...resGroupHeader, paddingLeft: indent }}
      >
        {open ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
        <LuFolder size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', ...ellipsis }}>{node.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {selectedCount > 0 ? `${selectedCount}/${contained.length}` : contained.length}
        </span>
      </button>
      {open && (
        <div>
          {node.folders.map((child) => (
            <ResourceGroup
              key={child.key}
              node={child}
              depth={depth + 1}
              openKeys={openKeys}
              onToggle={onToggle}
              selectedKeys={selectedKeys}
              toggleRow={toggleRow}
            />
          ))}
          {node.items.map((r) => {
            const checked = selectedKeys.has(resourceKey(r))
            return (
              <label key={resourceKey(r)} style={{ ...resRow(checked), paddingLeft: indent + 20 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRow(r)}
                  style={{ width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }}
                />
                <span style={{ flex: 1, minWidth: 0, ...ellipsis }}>{r.name}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
