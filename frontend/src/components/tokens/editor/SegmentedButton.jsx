/**
 * One option in a segmented control (mask shape).
 *
 * Its own file because the project lints one React component per file.
 */

export default function SegmentedButton({ selected, onClick, children, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={selected}
      style={{
        flex: 1,
        padding: '6px 8px',
        fontSize: 12,
        borderRadius: 5,
        cursor: 'pointer',
        background: selected ? 'var(--gold-dim)' : 'var(--bg-card)',
        color: selected ? 'var(--gold)' : 'var(--text-dim)',
        border: `1px solid ${selected ? 'var(--gold)' : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  )
}
