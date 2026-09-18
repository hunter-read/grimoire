import { LuPlus, LuTrash2, LuChevronUp, LuChevronDown } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import FieldRenderer from './FieldRenderer'
import { ghostBtn, iconBtn, fieldLabel } from './characterStyles'

/**
 * A repeatable table of typed rows — equipment, attacks, spell slots.
 *
 * Each column is itself a field definition, rendered through `FieldRenderer`,
 * so a column gains every type the renderer supports without this file knowing
 * about any of them.
 *
 * Rows are addressed by index rather than by a generated id. A row is only ever
 * meaningful in its position here, and storing an id would put a key in the
 * character's data that the schema never declared — which the server would
 * strip on the way in anyway.
 */
export default function ListField({ name, definition = {}, value, onChange, readOnly = false }) {
  const { t } = useTranslation()
  const columns = definition.columns || []
  const rows = Array.isArray(value) ? value : []

  const setRow = (index, key, cellValue) => {
    const next = rows.map((row, i) => (i === index ? { ...row, [key]: cellValue } : row))
    onChange?.(next)
  }

  const addRow = () => {
    const blank = {}
    for (const column of columns) {
      blank[column.key] = 'default' in column ? column.default : emptyFor(column.type)
    }
    onChange?.([...rows, blank])
  }

  const removeRow = (index) => onChange?.(rows.filter((_, i) => i !== index))

  const moveRow = (index, delta) => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange?.(next)
  }

  return (
    <div className="gc-list">
      {definition.label ? <div style={fieldLabel}>{definition.label}</div> : null}

      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 8px' }}>
          {definition.empty_text || t('characters.listEmpty')}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {/* Column headings, shown once rather than repeated per row — a label
              above every cell of every row makes a table unreadable. */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-muted)',
            }}
          >
            {columns.map((column) => (
              <div key={column.key} style={{ flex: column.flex || 1, minWidth: 0 }}>
                {column.label || column.key}
              </div>
            ))}
            {readOnly ? null : <div style={{ width: 84, flexShrink: 0 }} />}
          </div>

          {rows.map((row, index) => (
            <div
              // Index is the row's identity here; see the note above.
              key={index}
              style={{ display: 'flex', gap: 8, alignItems: 'center' }}
            >
              {columns.map((column) => (
                <div key={column.key} style={{ flex: column.flex || 1, minWidth: 0 }}>
                  <FieldRenderer
                    name={`${name}.${index}.${column.key}`}
                    definition={{ ...column, label: column.label || column.key }}
                    value={row?.[column.key]}
                    onChange={readOnly ? undefined : (v) => setRow(index, column.key, v)}
                    readOnly={readOnly}
                    hideLabel
                  />
                </div>
              ))}

              {readOnly ? null : (
                <div style={{ display: 'flex', gap: 2, width: 84, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => moveRow(index, -1)}
                    disabled={index === 0}
                    aria-label={t('characters.moveRowUp')}
                    title={t('characters.moveRowUp')}
                    style={{ ...iconBtn, opacity: index === 0 ? 0.3 : 1 }}
                  >
                    <LuChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveRow(index, 1)}
                    disabled={index === rows.length - 1}
                    aria-label={t('characters.moveRowDown')}
                    title={t('characters.moveRowDown')}
                    style={{ ...iconBtn, opacity: index === rows.length - 1 ? 0.3 : 1 }}
                  >
                    <LuChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    aria-label={t('characters.removeRow')}
                    title={t('characters.removeRow')}
                    style={iconBtn}
                  >
                    <LuTrash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {readOnly ? null : (
        <button
          type="button"
          onClick={addRow}
          style={{ ...ghostBtn, marginTop: 8, fontSize: 12, padding: '6px 12px' }}
        >
          <LuPlus size={13} />
          {definition.add_label || t('characters.addRow')}
        </button>
      )}
    </div>
  )
}

function emptyFor(type) {
  if (type === 'checkbox') return false
  if (type === 'number') return null
  return ''
}
