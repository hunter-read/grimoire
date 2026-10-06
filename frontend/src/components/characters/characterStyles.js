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
// useful if the button can be read. Fading it with opacity took its text below
// a readable contrast, so it keeps full-strength muted text and says
// "unavailable" with a recessed background and a dashed edge instead.
export const disabledBtn = {
  ...ghostBtn,
  background: 'var(--bg-deep)',
  borderStyle: 'dashed',
  color: 'var(--text-muted)',
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

// A section's title and its actions on one line, over one rule - the content
// tab's "Content packs" and "Rulesets" headings.
export const sectionBar = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  paddingBottom: 8,
  marginBottom: 8,
  borderBottom: '1px solid var(--border)',
}

export const sectionTitle = {
  flex: 1,
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-dim)',
}

// --- the sheet & ruleset manager ------------------------------------------
// One modal with two tabs, so "manage the content my characters draw on" is a
// single place rather than four buttons that each do a slice of it.

export const scrim = {
  position: 'fixed',
  inset: 0,
  background: 'var(--scrim-strong)',
  zIndex: 1100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
}

export const modalPanel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  width: '100%',
  maxWidth: 860,
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
}

export const modalHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '16px 20px 0',
}

export const modalBody = {
  flex: 1,
  overflowY: 'auto',
  padding: '16px 20px 20px',
}

export const tabList = {
  display: 'flex',
  gap: 4,
  padding: '12px 20px 0',
  borderBottom: '1px solid var(--border)',
}

// An underlined active tab rather than a filled one: the panel below is already
// a card, and two filled surfaces butting together reads as one shape.
export const tabBtn = (active) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  background: 'transparent',
  border: 'none',
  borderBottom: `2px solid ${active ? 'var(--gold)' : 'transparent'}`,
  color: active ? 'var(--text)' : 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  marginBottom: -1,
})

export const codeArea = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  fontFamily: 'monospace',
  fontSize: 12,
  resize: 'vertical',
}

export const helpText = {
  margin: '4px 0 0',
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--text-muted)',
}

// A list with nothing in it yet: the same size and colour as the help text
// around it, in a dashed panel so it reads as a place things will go.
export const emptyState = {
  margin: 0,
  padding: '18px 16px',
  border: '1px dashed var(--border)',
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--text-muted)',
  textAlign: 'center',
}
