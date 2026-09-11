import { LuChevronDown, LuChevronRight } from 'react-icons/lu'

/**
 * One collapsible section of the frame gallery, with its own heading button.
 *
 * A library can hold frames across many folders; collapsing a section the user
 * is not working from keeps the rest reachable without scrolling past it.
 */
export default function FrameGroup({ label, icon, open, onToggle, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          padding: 0,
          marginBottom: 6,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          textAlign: 'left',
        }}
      >
        {open ? (
          <LuChevronDown size={12} aria-hidden="true" />
        ) : (
          <LuChevronRight size={12} aria-hidden="true" />
        )}
        {icon}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </button>
      {open && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>}
    </div>
  )
}
