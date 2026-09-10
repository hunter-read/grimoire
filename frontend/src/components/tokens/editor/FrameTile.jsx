/**
 * One frame swatch in the picker.
 *
 * The checkerboard is not decoration: a gold ring on a dark panel and the same
 * ring on white read completely differently, and the pattern also communicates
 * that the middle of a frame is transparent.
 */
export default function FrameTile({ selected, label, onClick, children, size = 52 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      style={{
        width: size,
        height: size,
        padding: 0,
        borderRadius: 6,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-dim)',
        border: selected ? '2px solid var(--gold)' : '1px solid var(--border)',
        backgroundColor: 'var(--bg-deep)',
        backgroundImage:
          'linear-gradient(45deg, var(--bg-card) 25%, transparent 25%),' +
          'linear-gradient(-45deg, var(--bg-card) 25%, transparent 25%),' +
          'linear-gradient(45deg, transparent 75%, var(--bg-card) 75%),' +
          'linear-gradient(-45deg, transparent 75%, var(--bg-card) 75%)',
        backgroundSize: '10px 10px',
        backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px',
      }}
    >
      {children}
    </button>
  )
}
