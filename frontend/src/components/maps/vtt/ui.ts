/**
 * Shared inline styles for the Universal VTT editor.
 *
 * The editor is a dense tool surface — toolbar, layer panel, property panels —
 * and these are the handful of styles every one of them repeats. Kept as plain
 * objects to match how the rest of the map components are styled.
 */

import type { CSSProperties } from 'react'

export const inputStyle: CSSProperties = {
  padding: '4px 7px',
  fontSize: 13,
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--bg-input, var(--bg-deep))',
  color: 'var(--text)',
}

export const btnStyle: CSSProperties = {
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

export const iconBtnStyle: CSSProperties = { ...btnStyle, padding: '4px 7px' }

export const labelStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

export const sectionTitleStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 10,
}
