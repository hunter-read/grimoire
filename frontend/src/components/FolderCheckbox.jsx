import { LuCheck, LuMinus } from 'react-icons/lu'

/**
 * Tri-state checkbox shown on folder headers in bulk-select mode.
 * `indeterminate` renders a minus when some (but not all) children are selected.
 */
export default function FolderCheckbox({ checked, indeterminate, onChange }) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        flexShrink: 0,
        background: checked || indeterminate ? 'var(--gold)' : 'var(--bg-input)',
        border: checked || indeterminate ? 'none' : '2px solid var(--border-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      {checked && <LuCheck size={11} color="var(--on-accent)" strokeWidth={3} />}
      {indeterminate && !checked && <LuMinus size={11} color="var(--on-accent)" strokeWidth={3} />}
    </div>
  )
}
