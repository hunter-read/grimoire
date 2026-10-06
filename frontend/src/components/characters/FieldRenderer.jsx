import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LuRotateCcw, LuLink } from 'react-icons/lu'
import { fieldInput, fieldLabel, iconBtn } from './characterStyles'
import OverridableValue from './OverridableValue'
import CompactNumber from './CompactNumber'
import ListField from './ListField'
import MultiSelectField from './MultiSelectField'
import ContentRefField from './ContentRefField'
import ContentListField from './ContentListField'

/**
 * Renders one field from its schema definition and value.
 *
 * This is the single renderer the whole character system draws with. Phase 3
 * points it at content-catalog entries and Phase 4 at ruleset forms, so it
 * takes a field *definition* rather than anything sheet-specific, and it never
 * reaches for the character it belongs to.
 *
 * `readOnly` is a real mode, not a disabled input: a computed value and a
 * content-browser preview both render as text rather than as a greyed-out box
 * you can focus but not change.
 *
 * A field with `default_from` is still an ordinary editable field. `derived`
 * says the value shown was worked out from the player's choices; `onReset`,
 * once they have typed over it, hands it back to that automatic value. Neither
 * is set for a plain field, which renders exactly as it always did.
 */
export default function FieldRenderer({
  name,
  definition = {},
  value,
  onChange,
  readOnly = false,
  hideLabel = false,
  autoFocus = false,
  // Catalog context, supplied by the sheet. Only the content fields use it, but
  // it rides on every field so a layout does not have to know which is which.
  entries = {},
  schemaId,
  contentTypes = {},
  derived = false,
  onReset,
  // For a read-only computed value: lets the player overrule it anyway.
  onOverride,
  overridden = false,
  // `compact` draws a number without its spinner, for tight boxes.
  variant,
}) {
  const { t } = useTranslation()
  const inputId = useId()
  const type = definition.type || 'text'
  const label = definition.label || name

  // These two render their own label and structure, so they are delegated to
  // whole rather than wrapped in the scalar field chrome below.
  if (type === 'list') {
    return (
      <ListField
        name={name}
        definition={definition}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        hideLabel={hideLabel}
      />
    )
  }
  if (type === 'multiselect') {
    return (
      <MultiSelectField
        name={name}
        definition={definition}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        hideLabel={hideLabel}
      />
    )
  }
  if (type === 'content_ref') {
    return (
      <ContentRefField
        name={name}
        definition={definition}
        value={value}
        entries={entries}
        schemaId={schemaId}
        typeDefinition={contentTypes[definition.content_type] || {}}
        onChange={onChange}
        readOnly={readOnly}
        hideLabel={hideLabel}
      />
    )
  }
  if (type === 'content_list') {
    return (
      <ContentListField
        name={name}
        definition={definition}
        value={value}
        entries={entries}
        schemaId={schemaId}
        typeDefinition={contentTypes[definition.content_type] || {}}
        onChange={onChange}
        readOnly={readOnly}
        hideLabel={hideLabel}
      />
    )
  }

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
          {onOverride ? (
            <OverridableValue
              label={label}
              display={formatDisplay(type, value, definition)}
              raw={value}
              overridden={overridden}
              onOverride={onOverride}
            />
          ) : (
            formatDisplay(type, value, definition)
          )}
        </div>
      </div>
    )
  }

  const control = renderControl({
    inputId,
    type,
    definition,
    value,
    onChange,
    autoFocus,
    label,
    variant,
  })
  if (!derived && !onReset) {
    return (
      <div className="gc-field">
        {label_el}
        {control}
      </div>
    )
  }

  // Beside the control rather than in the label, so it survives a layout that
  // hides labels - the HTML sheets mostly do.
  // A small linked-chain icon rather than a word: on a sheet with a dozen
  // derived values, "AUTO" beside each one - every saving throw box - was more
  // prominent than the values themselves. The meaning is in the tooltip and
  // the accessible name.
  const marker = derived ? (
    <span
      role="img"
      title={t('characters.autoValueHint')}
      aria-label={t('characters.autoValueHint')}
      style={{ display: 'inline-flex', color: 'var(--text-muted)', opacity: 0.55, flexShrink: 0 }}
    >
      <LuLink size={11} />
    </span>
  ) : (
    <button
      type="button"
      onClick={onReset}
      aria-label={t('characters.resetToAuto')}
      title={t('characters.resetToAuto')}
      style={{ ...iconBtn, padding: 2 }}
    >
      <LuRotateCcw size={12} />
    </button>
  )

  return (
    <div className="gc-field">
      {label_el}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{control}</div>
        {marker}
      </div>
    </div>
  )
}

function renderControl({ inputId, type, definition, value, onChange, autoFocus, label, variant }) {
  const commonStyle = fieldInput

  switch (type) {
    case 'number':
      if (variant === 'compact') {
        return (
          <CompactNumber
            id={inputId}
            value={value}
            min={definition.min}
            max={definition.max}
            autoFocus={autoFocus}
            onChange={onChange}
            style={commonStyle}
          />
        )
      }
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
