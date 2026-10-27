// Shared styles for the campaign member row, invite panel, and sheet dialogs.

export const STATUS_COLORS = {
  accepted: 'var(--success)',
  invited: 'var(--gold)',
  declined: 'var(--danger)',
}

export const sheetActionBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  padding: 0,
  fontSize: 12,
}

// `color` defaults rather than being required: several call sites invoke this
// bare, which used to yield `color: undefined` and a black-on-dark button.
export const smallBtn = (color = 'var(--text-dim)') => ({
  background: 'var(--bg-deep)',
  border: `1px solid var(--border)`,
  borderRadius: 6,
  color,
  padding: '5px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
})
