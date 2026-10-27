/** Labelled metadata row used in the map/token detail sidebars. */
export default function MetaRow({ label, value }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 3,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}
