import { useId } from 'react'
import { fieldInput, fieldLabel } from './characterStyles'

/**
 * Renders one field from its schema definition and value.
 *
 * This is the single renderer the whole character system draws with. Phase 3
 * points it at content-catalog entries and Phase 4 at homebrew forms, so it
 * takes a field *definition* rather than anything sheet-specific, and it never
 * reaches for the character it belongs to.
 *
 * `readOnly` is a real mode, not a disabled input: a computed value and a
 * content-browser preview both render as text rather than as a greyed-out box
 * you can focus but not change.
 */
export default function FieldRenderer({
  name,
  definition = {},
  value,
  onChange,
  readOnly = false,
  hideLabel = false,
  autoFocus = false,
}) {
  const inputId = useId()
  const type = definition.type || 'text'
  const label = definition.label || name

  const label_el = hideLabel ? null : (
    <label htmlFor={inputId} style={fieldLabel}>
      {label}
    </label>
  )

  if (readOnly) {
    return (
      <div className="gc-field gc-field-readonly">
        {label_el}
        <div
          id={inputId}
          style={{
            padding: '6px 8px',
            border: '1px solid transparent',
            fontSize: 14,
            color: 'var(--text)',
            minHeight: 20,
          }}
        >
          {formatDisplay(type, value, definition)}
        </div>
      </div>
    )
  }

  return (
    <div className="gc-field">
      {label_el}
      {renderControl({ inputId, type, definition, value, onChange, autoFocus, label })}
    </div>
  )
}

function renderControl({ inputId, type, definition, value, onChange, autoFocus, label }) {
  const commonStyle = fieldInput

  switch (type) {
    case 'number':
      return (
        <input
          id={inputId}
          type="number"
          value={value ?? ''}
          min={definition.min}
          max={definition.max}
          autoFocus={autoFocus}
          onChange={(e) => onChange?.(e.target.value === '' ? null : Number(e.target.value))}
          style={{ ...commonStyle, textAlign: 'center' }}
        />
      )

    case 'checkbox':
      return (
        <input
          id={inputId}
          type="checkbox"
          checked={!!value}
          autoFocus={autoFocus}
          onChange={(e) => onChange?.(e.target.checked)}
          aria-label={label}
          style={{ width: 16, height: 16, accentColor: 'var(--gold)' }}
        />
      )

    case 'textarea':
      return (
        <textarea
          id={inputId}
          value={value ?? ''}
          rows={definition.rows || 4}
          placeholder={definition.placeholder || ''}
          autoFocus={autoFocus}
          onChange={(e) => onChange?.(e.target.value)}
          style={{ ...commonStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      )

    case 'select':
      return (
        <select
          id={inputId}
          value={value ?? ''}
          autoFocus={autoFocus}
          onChange={(e) => onChange?.(e.target.value)}
          style={commonStyle}
        >
          <option value="">—</option>
          {(definition.options || []).map((option) => {
            const optionValue = typeof option === 'object' ? option.value : option
            const optionLabel = typeof option === 'object' ? option.label || option.value : option
            return (
              <option key={optionValue} value={optionValue}>
                {optionLabel}
              </option>
            )
          })}
        </select>
      )

    default:
      return (
        <input
          id={inputId}
          type="text"
          value={value ?? ''}
          placeholder={definition.placeholder || ''}
          autoFocus={autoFocus}
          onChange={(e) => onChange?.(e.target.value)}
          style={commonStyle}
        />
      )
  }
}

// Read-only display. A checkbox reads as a tick rather than "true", and a select
// shows its option's label rather than the stored value — the value is an
// identifier, and showing it would leak a detail the player never chose.
function formatDisplay(type, value, definition) {
  if (type === 'checkbox') return value ? '✓' : '—'
  if (type === 'select') {
    const match = (definition.options || []).find((option) =>
      typeof option === 'object' ? option.value === value : option === value
    )
    if (match) return typeof match === 'object' ? match.label || match.value : match
  }
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}
