import { LuArrowLeft } from 'react-icons/lu'

/**
 * The editor's top bar: back, title, the file being worked on, then actions.
 *
 * Shared by the editor proper and the standalone source picker so the page does
 * not appear to change shape when a file is chosen — the bar is already there,
 * and only what sits at its right-hand end differs.
 */
export default function EditorHeader({ title, subtitle, onBack, backLabel, backAria, children }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <button
        onClick={onBack}
        aria-label={backAria || backLabel}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-dim)',
          fontSize: 15,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <LuArrowLeft size={15} aria-hidden="true" /> {backLabel}
      </button>
      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
      <span style={{ fontSize: 15, fontWeight: 500 }}>{title}</span>
      <span
        style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {subtitle}
      </span>
      <div style={{ flex: 1 }} />
      {children}
    </div>
  )
}
