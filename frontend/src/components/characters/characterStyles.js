// Shared styles for the character builder, following the same vocabulary as
// `campaigns/sheetEditorStyles.js` — gold for the primary action, a bordered
// ghost for everything else, and the app's own tokens throughout.
//
// The app has no `.btn-primary`/`.btn-secondary` classes: buttons are styled
// inline from these tokens, which is what keeps a theme able to restyle them.
// Only tokens defined in `index.css` are used here, so a theme that overrides
// `--gold` or `--bg-card` reaches this feature too.

export const goldBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  background: 'var(--gold)',
  border: 'none',
  borderRadius: 8,
  color: 'var(--on-accent)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

export const ghostBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 16px',
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 13,
  whiteSpace: 'nowrap',
}

// A disabled action stays legible rather than vanishing: "New character" is
// disabled until a sheet is installed, and the tooltip explaining that is only
// useful if the button can still be seen and hovered.
export const disabledBtn = {
  ...ghostBtn,
  opacity: 0.55,
  cursor: 'not-allowed',
}

// An icon-only affordance (delete, remove) — no chrome until hovered, so a row
// of them does not compete with the content beside it.
export const iconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 6,
  background: 'none',
  border: 'none',
  borderRadius: 6,
  color: 'var(--text-muted)',
  cursor: 'pointer',
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

export const fieldLabel = {
  display: 'block',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
  marginBottom: 4,
}

export const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 16,
}

export const sectionHeading = {
  margin: '0 0 12px',
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border)',
  paddingBottom: 6,
}
