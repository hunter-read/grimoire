import type { ReactNode } from 'react'

/**
 * A small on/off switch styled as a toggle.
 *
 * Props:
 *  - labelFirst: render the label before the switch (default: switch then label)
 *  - pill: wrap the whole control in a bordered, button-like pill so clicking
 *    anywhere on it toggles (the whole thing is a <label>, so it already does).
 */
export interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  id?: string
  labelFirst?: boolean
  pill?: boolean
}

export default function ToggleSwitch({
  checked,
  onChange,
  label,
  id,
  labelFirst = false,
  pill = false,
}: ToggleSwitchProps) {
  const track = (
    <span key="track" style={{ position: 'relative', width: 38, height: 22, flexShrink: 0 }}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        // Invisible but the size of the track, not 0x0: a touch screen reader
        // finds a control by what lies under the finger.
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          margin: 0,
          opacity: 0,
          cursor: 'pointer',
          zIndex: 1,
        }}
      />
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 22,
          background: checked ? 'var(--gold)' : 'var(--bg-deep)',
          // The track's outline is what shows an "off" switch is there at all.
          border: '1px solid var(--border-control)',
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
      className="toggle-switch"
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
