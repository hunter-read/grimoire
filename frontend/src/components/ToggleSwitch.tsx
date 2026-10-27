/**
 * A small on/off switch styled as a toggle.
 *
 * Props:
 *  - labelFirst: render the label before the switch (default: switch then label)
 *  - pill: wrap the whole control in a bordered, button-like pill so clicking
 *    anywhere on it toggles (the whole thing is a <label>, so it already does).
 */
export default function ToggleSwitch({
  checked,
  onChange,
  label,
  id,
  labelFirst = false,
  pill = false,
}) {
  const track = (
    <span key="track" style={{ position: 'relative', width: 38, height: 22, flexShrink: 0 }}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 22,
          background: checked ? 'var(--gold)' : 'var(--bg-deep)',
          border: '1px solid var(--border)',
          transition: 'background 0.15s',
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: checked ? 'var(--on-accent)' : 'var(--text-muted)',
          transition: 'left 0.15s',
        }}
      />
    </span>
  )
  const labelNode = label != null ? <span key="label">{label}</span> : null

  return (
    <label
      htmlFor={id}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        ...(pill
          ? {
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
            }
          : null),
      }}
    >
      {labelFirst ? [labelNode, track] : [track, labelNode]}
    </label>
  )
}
