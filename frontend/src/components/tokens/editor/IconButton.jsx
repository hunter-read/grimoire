/**
 * A small square icon button; `active` renders it as pressed.
 *
 * Its own file because the project lints one React component per file.
 */

export default function IconButton({ onClick, title, children, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 34,
        borderRadius: 5,
        cursor: 'pointer',
        background: active ? 'var(--gold-dim)' : 'var(--bg-card)',
        color: active ? 'var(--gold)' : 'var(--text-dim)',
        border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  )
}
