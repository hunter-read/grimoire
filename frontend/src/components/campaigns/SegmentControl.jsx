/** Segmented button group (single-select) used in the schedule editor. */
export default function SegmentControl({ value, options, onChange }) {
  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--bg-deep)',
        borderRadius: 10,
        padding: 4,
        gap: 2,
      }}
    >
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          style={{
            flex: 1,
            padding: '7px 4px',
            borderRadius: 7,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            border: 'none',
            background: value === o.key ? 'var(--bg-card)' : 'transparent',
            color: value === o.key ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: value === o.key ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
            transition: 'all 0.15s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
