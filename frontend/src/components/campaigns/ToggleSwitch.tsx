/** A small on/off switch styled as a toggle. */
import type { ReactNode } from 'react'

interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  id?: string
}

export default function ToggleSwitch({ checked, onChange, label, id }: ToggleSwitchProps) {
  return (
    <label
      htmlFor={id}
      // The checkbox is invisible, so the focus ring goes on the label.
      className="toggle-switch"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
    >
      <span style={{ position: 'relative', width: 38, height: 22, flexShrink: 0 }}>
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
      {label}
    </label>
  )
}
