export const labelStyle = {
  fontSize: 13,
  color: 'var(--text-muted)',
  fontWeight: 500,
  display: 'block',
  marginBottom: 6,
}
export const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 14,
  boxSizing: 'border-box',
}
export const cancelBtn = {
  padding: '9px 18px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 14,
}
export const submitBtn = {
  padding: '9px 18px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
}
export const deleteBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 16px',
  // Match the "Remove missing files" button on Settings → Maintenance.
  background: 'rgba(180,60,60,0.15)',
  border: '1px solid rgba(180,60,60,0.5)',
  borderRadius: 8,
  color: 'var(--danger)',
  cursor: 'pointer',
  fontSize: 14,
}
export const sectionLabel = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  marginBottom: 8,
}
export const selectedRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
}
export const visibilitySelect = {
  appearance: 'auto',
  fontSize: 12,
  padding: '3px 6px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  flexShrink: 0,
}
// Defaulted for the same reason as `smallBtn`: a bare call must not produce
// `color: undefined`, which renders as UA-default black on the dark panels.
export const iconBtn = (color = 'var(--text-dim)') => ({
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color,
  display: 'flex',
  padding: 2,
  flexShrink: 0,
})
export const resultEmpty = {
  fontSize: 13,
  color: 'var(--text-muted)',
  padding: '10px 12px',
}
export const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
export const browserBox = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-deep)',
  maxHeight: 300,
  overflowY: 'auto',
}
export const resGroup = {
  borderBottom: '1px solid var(--border)',
}
export const resGroupHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  background: 'none',
  border: 'none',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}
export const resRow = (checked) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px 6px 30px',
  fontSize: 13,
  cursor: 'pointer',
  color: checked ? 'var(--text)' : 'var(--text-dim)',
  background: checked ? 'rgba(201,168,76,0.08)' : 'transparent',
})
export const typeTab = (active) => ({
  flex: 1,
  padding: '5px 8px',
  fontSize: 12,
  borderRadius: 6,
  cursor: 'pointer',
  border: active ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
  background: active ? 'rgba(201,168,76,0.15)' : 'var(--bg-deep)',
  color: active ? 'var(--gold)' : 'var(--text-dim)',
})
