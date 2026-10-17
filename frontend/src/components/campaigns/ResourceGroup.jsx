import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronDown, LuChevronRight, LuFolder } from 'react-icons/lu'
import { resourceKey, nodeResources } from './resourcesShared'
import { resGroup, resGroupHeader, ellipsis, resRow } from './campaignEditorShared'

const folderCheckboxStyle = { width: 15, height: 15, flexShrink: 0, cursor: 'pointer', margin: 0 }

/**
 * One collapsible folder in the resource picker's folder tree. Renders nested
 * subfolders recursively (arbitrary depth) before its own loose items, so the
 * system → category → subcategory → … structure is browsable in place.
 *
 * The folder's own checkbox selects everything in it, subfolders included, and
 * clears it again once all of it is selected (issue #555). It shows a partial
 * state while only some of the folder is selected. `toggleFolder(rows, select)`
 * adds or removes those rows.
 */
export default function ResourceGroup({
  node,
  depth = 0,
  openKeys,
  onToggle,
  selectedKeys,
  toggleRow,
  toggleFolder,
}) {
  const { t } = useTranslation()
  const open = openKeys.has(node.key)
  const contained = nodeResources(node)
  const selectedCount = contained.filter((r) => selectedKeys.has(resourceKey(r))).length
  const allSelected = contained.length > 0 && selectedCount === contained.length
  const someSelected = selectedCount > 0 && !allSelected
  // `indeterminate` has no HTML attribute, so it can only be set on the element.
  const folderBox = useRef(null)
  useEffect(() => {
    if (folderBox.current) folderBox.current.indeterminate = someSelected
  }, [someSelected])
  // Indent nested folders/rows a little further at each level.
  const indent = 10 + depth * 14

  return (
    <div style={resGroup}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: indent }}>
        <input
          ref={folderBox}
          type="checkbox"
          checked={allSelected}
          onChange={() => toggleFolder(contained, !allSelected)}
          aria-label={t('campaignEditor.resources.selectFolder', { name: node.name })}
          title={t('campaignEditor.resources.selectFolder', { name: node.name })}
          style={folderCheckboxStyle}
        />
        <button
          type="button"
          onClick={() => onToggle(node.key)}
          aria-expanded={open}
          style={{ ...resGroupHeader, width: 'auto', flex: 1, minWidth: 0, paddingLeft: 0 }}
        >
          {open ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
          <LuFolder size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ flex: 1, textAlign: 'left', ...ellipsis }}>{node.name}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
            {selectedCount > 0 ? `${selectedCount}/${contained.length}` : contained.length}
          </span>
        </button>
      </div>
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
              toggleFolder={toggleFolder}
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
