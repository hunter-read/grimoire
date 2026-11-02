import { useId, type ReactNode } from 'react'

interface Props {
  id: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  hint?: ReactNode
}

/**
 * A labelled checkbox for a settings page, with an optional hint underneath
 * (aligned with the label text, not the box).
 */
export default function SettingToggle({
  id,
  checked,
  disabled,
  onChange,
  label: text,
  hint,
}: Props) {
  const hintId = useId()
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: disabled ? 'default' : 'pointer',
          width: 'fit-content',
        }}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          // The hint is read with the box, not only when someone reads on.
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: 'var(--gold)' }}
        />
        <span style={{ fontSize: 14, color: 'var(--text)' }}>{text}</span>
      </label>
      {hint && (
        <p
          id={hintId}
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            margin: '6px 0 0 28px',
            lineHeight: 1.5,
          }}
        >
          {hint}
        </p>
      )}
    </div>
  )
}
