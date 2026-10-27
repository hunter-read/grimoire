/** Labelled column used inside the expanded user editor grid. */
export default function EditorField({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </div>
  )
}

export const fieldLabelStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}
