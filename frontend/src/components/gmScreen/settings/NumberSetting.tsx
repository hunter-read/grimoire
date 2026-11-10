import { fieldInput, fieldLabel } from '../../characters/characterStyles'

interface NumberSettingProps {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  /** Whether it may be left empty, meaning "no limit". */
  optional?: boolean
  placeholder?: string
}

/** A whole-number setting, optionally left empty. */
export default function NumberSetting({
  label,
  value,
  onChange,
  optional,
  placeholder,
}: NumberSettingProps) {
  return (
    <label style={fieldLabel}>
      {label}
      <input
        type="number"
        step={1}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => {
          const text = event.target.value
          if (text === '') onChange(optional ? null : 0)
          else if (Number.isFinite(Number(text))) onChange(Math.trunc(Number(text)))
        }}
        style={fieldInput}
      />
    </label>
  )
}
