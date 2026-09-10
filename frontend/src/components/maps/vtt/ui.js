/**
 * Shared inline styles for the Universal VTT editor.
 *
 * The editor is a dense tool surface — toolbar, layer panel, property panels —
 * and these are the handful of styles every one of them repeats. Kept as plain
 * objects to match how the rest of the map components are styled.
 */

export const inputStyle = {
  padding: '4px 7px',
  fontSize: 13,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-input, var(--bg-deep))',
  color: 'var(--text)',
}

export const btnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '5px 11px',
  fontSize: 13,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  cursor: 'pointer',
}

export const iconBtnStyle = { ...btnStyle, padding: '4px 7px' }

export const labelStyle = {
  fontSize: 10,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

export const sectionTitleStyle = {
  fontSize: 12,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 10,
}

/** Caption introducing a group of related controls in a dense toolbar. */
export const groupLabelStyle = {
  fontSize: 10,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  alignSelf: 'center',
}
