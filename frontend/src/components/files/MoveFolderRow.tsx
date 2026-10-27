import { LuChevronRight, LuFolder, LuFolderOpen, LuLock } from 'react-icons/lu'

// Indent per tree level. Matches FilePane's stepping so the destination picker
// and the file manager read as the same tree seen through different windows.
const INDENT = 14

/** One folder in the destination tree: a disclosure caret plus a select target. */
export default function MoveFolderRow({
  entry,
  depth,
  open,
  selected,
  blocked,
  onToggle,
  onSelect,
  blockedLabel,
  expandLabel,
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <button
        type="button"
        onClick={onToggle}
        // Named distinctly from the row's select button beside it, which
        // carries the folder's own name: two controls sharing one accessible
        // name would leave a screen-reader user unable to tell "open this
        // folder" from "move into it".
        aria-label={expandLabel}
        aria-expanded={open}
        style={{
          ...moveRowStyle(depth, false, false),
          width: 'auto',
          paddingRight: 0,
          background: 'none',
        }}
      >
        <LuChevronRight
          size={13}
          aria-hidden="true"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}
        />
      </button>
      <button
        type="button"
        onClick={() => !blocked && onSelect()}
        disabled={blocked}
        aria-pressed={selected}
        title={blocked ? blockedLabel : entry.path}
        style={{
          ...moveRowStyle(0, selected, blocked),
          flex: 1,
          paddingLeft: 4,
          minWidth: 0,
        }}
      >
        {open ? <LuFolderOpen size={13} /> : <LuFolder size={13} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name}
        </span>
        {blocked && <LuLock size={11} aria-hidden="true" style={{ flexShrink: 0 }} />}
      </button>
    </div>
  )
}

export function moveRowStyle(depth, selected, disabled) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    height: 28,
    padding: `0 8px 0 ${8 + depth * INDENT}px`,
    border: 'none',
    borderRadius: 5,
    background: selected ? 'var(--gold-dim)' : 'none',
    color: selected ? 'var(--on-accent)' : disabled ? 'var(--text-muted)' : 'var(--text)',
    fontSize: 13,
    textAlign: 'left',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  }
}
