// Shared styles for the search results view and its result sub-components.

export const sectionHeadStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  marginBottom: 10,
  color: 'var(--text-muted)',
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 0',
}

export const cardStyle = {
  background: 'var(--bg-card)',
  // Set explicitly rather than left to inherit: this style is spread onto
  // <button> elements (the book-title rows in BookGroup), and a button without
  // an explicit colour is exactly what caused issue #264.
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '12px 16px',
  marginBottom: 8,
  cursor: 'pointer',
  transition: 'background 0.15s',
}

export const controlStyle = {
  fontSize: 13,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  cursor: 'pointer',
}
