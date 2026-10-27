// Shared modal styles for the character-sheet editor and its template picker.

export const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim-strong)',
  zIndex: 1100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

export const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  padding: 24,
  width: '100%',
  maxWidth: 520,
  maxHeight: '85vh',
  overflowY: 'auto',
  position: 'relative',
}

export const closeBtn = {
  position: 'absolute',
  top: 14,
  right: 14,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
}

export const goldBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 16px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}

export const ghostBtn = {
  padding: '9px 16px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
}

export const fieldInput = {
  width: '100%',
  padding: '7px 9px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  fontSize: 13,
}
