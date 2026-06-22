import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import { resourceKey, resGroup, resGroupHeader, ellipsis, resRow } from './campaignEditorShared'

/** One collapsible folder/category section in the campaign-editor resource browser. */
export default function ResourceGroup({
  groupKey,
  label,
  Icon,
  rows,
  open,
  onToggle,
  selectedKeys,
  toggleRow,
}) {
  const selectedCount = rows.filter((r) => selectedKeys.has(resourceKey(r))).length
  return (
    <div style={resGroup}>
      <button type="button" onClick={() => onToggle(groupKey)} style={resGroupHeader}>
        {open ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
        <Icon size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', ...ellipsis }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {selectedCount > 0 ? `${selectedCount}/${rows.length}` : rows.length}
        </span>
      </button>
      {open && (
        <div>
          {rows.map((r) => {
            const checked = selectedKeys.has(resourceKey(r))
            return (
              <label key={resourceKey(r)} style={resRow(checked)}>
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
