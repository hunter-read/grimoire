/**
 * A labelled on/off switch with an explanatory line under it.
 *
 * Split out because the preview panel's vision controls are a set of related
 * switches that each need the same shape — name, state, and one sentence
 * saying what turning it off actually does. Inline checkboxes lost that last
 * part, and "Night Vision" with no explanation is exactly the kind of label
 * that means something to whoever wrote it and nothing to the GM reading it.
 *
 * Rendered as a real `<input type="checkbox">` rather than a styled `<div>`:
 * it is reachable by keyboard and announced correctly by a screen reader for
 * free, and the visual switch is drawn from the input's own checked state.
 */
export default function Toggle({ label, hint, checked, onChange }) {
  return (
    <div style={{ marginTop: 12 }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <span>{label}</span>
        <input
          type="checkbox"
          checked={checked}
          aria-label={label}
          onChange={(e) => onChange(e.target.checked)}
          style={{ flexShrink: 0 }}
        />
      </label>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </div>
  )
}
