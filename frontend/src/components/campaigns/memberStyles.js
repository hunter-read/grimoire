// Shared styles for the campaign member row, invite panel, and sheet dialogs.

export const STATUS_COLORS = {
  accepted: 'var(--success, #4caf50)',
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

export const smallBtn = (color) => ({
  background: 'var(--bg-deep)',
  border: `1px solid var(--border)`,
  borderRadius: 6,
  color,
  padding: '5px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
})
