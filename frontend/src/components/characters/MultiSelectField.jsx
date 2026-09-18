import { useId } from 'react'
import { fieldLabel } from './characterStyles'

/**
 * A multi-choice field, rendered as a group of checkboxes.
 *
 * Deliberately not a `<select multiple>`: that control hides its options until
 * focused, requires ctrl-clicking to pick more than one, and is close to
 * unusable on touch. A character's languages or proficiencies are a short,
 * known list that should simply be visible.
 *
 * The stored value keeps the schema's option order rather than click order, so
 * a sheet reads the same each time it is opened. The server enforces the same
 * thing, since it is the authority.
 */
export default function MultiSelectField({
  name,
  definition = {},
  value,
  onChange,
  readOnly = false,
  hideLabel = false,
}) {
  const groupId = useId()
  const options = definition.options || []
  const selected = Array.isArray(value) ? value : []

  const toggle = (optionValue) => {
    const next = selected.includes(optionValue)
      ? selected.filter((item) => item !== optionValue)
      : [...selected, optionValue]
    // Re-order to the schema's own option order.
    onChange?.(optionValues(options).filter((option) => next.includes(option)))
  }

  if (readOnly) {
    const labels = options
      .filter((option) => selected.includes(valueOf(option)))
      .map((option) => labelOf(option))
    return (
      <div className="gc-field gc-field-readonly">
        {hideLabel ? null : <div style={fieldLabel}>{definition.label || name}</div>}
        <div style={{ padding: '6px 8px', fontSize: 14, color: 'var(--text)' }}>
          {labels.length ? labels.join(', ') : '—'}
        </div>
      </div>
    )
  }

  return (
    <fieldset className="gc-field" style={{ border: 'none', margin: 0, padding: 0 }}>
      {hideLabel ? null : (
        <legend style={{ ...fieldLabel, padding: 0 }}>{definition.label || name}</legend>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', paddingTop: 2 }}>
        {options.map((option) => {
          const optionValue = valueOf(option)
          const optionId = `${groupId}-${optionValue}`
          return (
            <label
              key={optionValue}
              htmlFor={optionId}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <input
                id={optionId}
                type="checkbox"
                checked={selected.includes(optionValue)}
                onChange={() => toggle(optionValue)}
                style={{ width: 15, height: 15, accentColor: 'var(--gold)' }}
              />
              {labelOf(option)}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const valueOf = (option) => (typeof option === 'object' ? option.value : option)
const labelOf = (option) => (typeof option === 'object' ? option.label || option.value : option)
const optionValues = (options) => options.map(valueOf)
