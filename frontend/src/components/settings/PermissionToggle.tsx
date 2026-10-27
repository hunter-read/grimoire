/** Checkbox + label permission toggle used in the expanded user editor. */
export default function PermissionToggle({
  id,
  label,
  title,
  checked,
  accent,
  disabled,
  onChange,
}) {
  return (
    <label
      htmlFor={id}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        style={{
          width: 14,
          height: 14,
          cursor: disabled ? 'not-allowed' : 'pointer',
          accentColor: accent,
        }}
      />
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
    </label>
  )
}
