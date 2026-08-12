// Shared styling for the note-template modal and its panels. Split out so
// each component can live in its own file (eslint react/no-multi-comp).
const backdrop = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim-strong)',
  zIndex: 1100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  padding: 24,
  width: '100%',
  maxWidth: 620,
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
}

const closeBtn = {
  position: 'absolute',
  top: 14,
  right: 14,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
}

const scrollArea = {
  overflowY: 'auto',
  minHeight: 0,
  flex: 1,
  margin: '0 -4px',
  padding: '0 4px',
}

const groupHeading = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  marginBottom: 6,
}

const row = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
}

const rowMain = (busy) => ({
  flex: 1,
  minWidth: 0,
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: 'var(--text)',
  cursor: busy ? 'wait' : 'pointer',
  font: 'inherit',
  padding: 0,
})

const rowDesc = {
  display: 'block',
  fontSize: 12,
  color: 'var(--text-dim)',
  marginTop: 2,
  lineHeight: 1.5,
}

const systemTag = { fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6, fontSize: 12 }

const folderRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  background: 'transparent',
  border: 'none',
  borderRadius: 8,
  color: 'var(--text)',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
}

const iconBtn = {
  flexShrink: 0,
  display: 'inline-flex',
  background: 'none',
  border: 'none',
  padding: 4,
  cursor: 'pointer',
  color: 'var(--text-muted)',
}

const emptyText = {
  fontSize: 13,
  color: 'var(--text-muted)',
  padding: '8px 0',
  lineHeight: 1.6,
}

const label = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: 'var(--text-dim)',
}

const input = {
  width: '100%',
  padding: '7px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 13,
  boxSizing: 'border-box',
}

const chip = (active) => ({
  padding: '5px 12px',
  background: active ? 'var(--gold)' : 'transparent',
  border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
  borderRadius: 14,
  color: active ? 'var(--on-accent)' : 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: active ? 600 : 400,
})

// Both button styles keep their label on one line. They sit in flex rows beside
// a greedy input, and some translations are much longer than the English
// ("Reset" → "Zurücksetzen"), so without this the text wraps mid-word.
const goldBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 14px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const ghostBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  padding: '6px 10px',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 12,
  whiteSpace: 'nowrap',
}

const dashedBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  justifyContent: 'center',
  padding: '7px 10px',
  background: 'transparent',
  border: '1px dashed var(--border)',
  borderRadius: 8,
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 12,
}

export {
  backdrop,
  panel,
  closeBtn,
  scrollArea,
  groupHeading,
  row,
  rowMain,
  rowDesc,
  systemTag,
  folderRow,
  iconBtn,
  emptyText,
  label,
  input,
  chip,
  goldBtn,
  ghostBtn,
  dashedBtn,
}
