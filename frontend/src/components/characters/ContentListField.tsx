import { useState, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuTrash2, LuPencil } from 'react-icons/lu'
import ContentBrowser from './ContentBrowser'
import FieldRenderer from './FieldRenderer'
import ContentEntryDetail from './ContentEntryDetail'
import { ghostBtn, iconBtn, fieldLabel } from './characterStyles'

/**
 * Many picks from the catalog — spells known, feats, cyberware.
 *
 * Each row stores `{_ref, _source}` plus the character's own `_per` notes
 * (prepared, equipped, uses remaining), which are ordinary fields the schema
 * declares as `per_entry_fields` and which render through `FieldRenderer` like
 * anything else.
 *
 * `allow_freeform` adds an `_inline` row: something the player types rather
 * than picks. That is the escape hatch that keeps the catalog optional — a
 * player who wants to write their own list never has to open the browser.
 */
export default function ContentListField({
  name,
  definition = {},
  value,
  entries = {},
  schemaId,
  typeDefinition = {},
  onChange,
  readOnly = false,
  hideLabel = false,
}) {
  const { t } = useTranslation()
  const [browsing, setBrowsing] = useState(false)
  // Which rows are open to show the whole entry, by position.
  const [open, setOpen] = useState(() => new Set())

  const rows = Array.isArray(value) ? value : []
  const perFields = definition.per_entry_fields || {}
  // `display_columns` draws the list as a table of the entries' own properties
  // - a spell's level, casting time and range - the way a printed sheet lists
  // them. Without it, each row is a name and a one-line summary.
  const columns = (definition.display_columns || []).map((column) =>
    typeof column === 'string'
      ? { key: column, label: typeDefinition.fields?.[column]?.label || column }
      : column
  )

  const add = (picked) => {
    // Picking something already on the sheet is a no-op rather than a duplicate
    // row: two copies of the same spell is never what was meant.
    if (rows.some((row) => row?._ref === picked._ref)) return
    onChange?.([...rows, picked])
  }

  // A new custom entry opens straight away, ready to be named.
  const addInline = () => {
    onChange?.([...rows, { _inline: true, name: '' }])
    setOpen((prev) => new Set(prev).add(rows.length))
  }

  const remove = (index) => {
    onChange?.(rows.filter((_, i) => i !== index))
    setOpen(new Set())
  }

  const toggle = (index) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  const setPer = (index, key, cellValue) =>
    onChange?.(
      rows.map((row, i) =>
        i === index ? { ...row, _per: { ...(row._per || {}), [key]: cellValue } } : row
      )
    )

  const setInline = (index, key, cellValue) =>
    onChange?.(rows.map((row, i) => (i === index ? { ...row, [key]: cellValue } : row)))

  // The fields a freeform entry can be given - the content type's own, so a
  // custom trait has a description just as a catalog one does.
  const inlineFields = Object.keys(typeDefinition.fields || {}).length
    ? typeDefinition.fields
    : { name: { type: 'text', label: t('characters.name') } }

  const cell = { padding: '6px 6px', fontSize: 12, verticalAlign: 'middle' }
  const perCells = (row, index) =>
    Object.entries(perFields).map(([key, perDefinition]) => (
      <td key={key} style={{ ...cell, width: perDefinition.type === 'checkbox' ? 1 : 70 }}>
        <FieldRenderer
          name={`${name}.${index}.${key}`}
          definition={perDefinition}
          value={row?._per?.[key]}
          onChange={readOnly ? undefined : (v) => setPer(index, key, v)}
          readOnly={readOnly}
          hideLabel={columns.length > 0}
        />
      </td>
    ))

  return (
    <div className="gc-content-list">
      {definition.label && !hideLabel ? <div style={fieldLabel}>{definition.label}</div> : null}

      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 8px' }}>
          {t('characters.listEmpty')}
        </p>
      ) : (
        // A table either way: rows separated by rules rather than each drawn as
        // a card, which inside a sheet's own panels became cards within cards.
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          {columns.length ? (
            <thead>
              <tr>
                <th style={{ ...cell, ...headCell }}>
                  {typeDefinition.fields?.name?.label || t('characters.name')}
                </th>
                {columns.map((column) => (
                  <th key={column.key} style={{ ...cell, ...headCell }}>
                    {column.label}
                  </th>
                ))}
                {Object.entries(perFields).map(([key, perDefinition]) => (
                  <th key={key} style={{ ...cell, ...headCell }}>
                    {perDefinition.label || key}
                  </th>
                ))}
                {readOnly ? null : <th style={{ ...cell, ...headCell, width: 1 }} />}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((row, index) => {
              const entry = row?._ref ? entries[row._ref] : null
              const missing = !!row?._ref && !entry
              const expanded = open.has(index)
              const detail = entry || (row?._inline ? row : null)
              return (
                <Fragment key={row?._ref || `inline-${index}`}>
                  <tr style={{ borderBottom: expanded ? 'none' : '1px solid var(--border)' }}>
                    <td style={cell}>
                      {row?._inline ? (
                        <button
                          type="button"
                          onClick={() => toggle(index)}
                          aria-expanded={expanded}
                          aria-label={t(
                            expanded ? 'characters.hideEntry' : 'characters.showEntry',
                            {
                              name: row.name || t('characters.customEntry'),
                            }
                          )}
                          style={nameButton}
                        >
                          <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>
                            <span
                              aria-hidden="true"
                              style={{ marginRight: 4, color: 'var(--text-muted)' }}
                            >
                              {expanded ? '▾' : '▸'}
                            </span>
                            <span>{row.name || t('characters.customEntry')}</span>
                          </span>
                          {!columns.length && summaryOf(row, typeDefinition) ? (
                            <span
                              style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}
                            >
                              {summaryOf(row, typeDefinition)}
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggle(index)}
                          aria-expanded={expanded}
                          aria-label={t(
                            expanded ? 'characters.hideEntry' : 'characters.showEntry',
                            {
                              name: entry?.name || row?._ref,
                            }
                          )}
                          style={nameButton}
                        >
                          <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>
                            {/* Its own element, so the name stays a clean text on its
                                own - for a screen reader, and for finding it. */}
                            <span
                              aria-hidden="true"
                              style={{ marginRight: 4, color: 'var(--text-muted)' }}
                            >
                              {expanded ? '▾' : '▸'}
                            </span>
                            <span>{entry?.name || row?._ref}</span>
                            {missing ? (
                              <span
                                style={{ color: 'var(--warning)', fontSize: 11, marginLeft: 6 }}
                              >
                                {t('characters.entryMissing')}
                              </span>
                            ) : null}
                          </span>
                          {entry && !columns.length ? (
                            <span
                              style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}
                            >
                              {summaryOf(entry, typeDefinition)}
                            </span>
                          ) : null}
                        </button>
                      )}
                    </td>
                    {columns.map((column) => (
                      <td key={column.key} style={{ ...cell, color: 'var(--text-dim)' }}>
                        {formatCell(detail?.[column.key])}
                      </td>
                    ))}
                    {perCells(row, index)}
                    {readOnly ? null : (
                      <td style={{ ...cell, width: 1 }}>
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          aria-label={t('characters.removeEntry')}
                          title={t('characters.removeEntry')}
                          style={iconBtn}
                        >
                          <LuTrash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                  {expanded && (entry || row?._inline) ? (
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td
                        colSpan={
                          1 + columns.length + Object.keys(perFields).length + (readOnly ? 0 : 1)
                        }
                      >
                        {entry ? (
                          // The whole entry - a feat's description, a spell's
                          // text - drawn by the component the browser uses.
                          <ContentEntryDetail
                            entry={{ data: entry }}
                            typeDefinition={typeDefinition}
                          />
                        ) : (
                          // A freeform entry is the player's to fill in.
                          <div style={inlineEditor}>
                            {Object.entries(inlineFields).map(([key, fieldDefinition]) => (
                              <div
                                key={key}
                                style={
                                  fieldDefinition.type === 'textarea'
                                    ? { gridColumn: '1 / -1' }
                                    : undefined
                                }
                              >
                                <FieldRenderer
                                  name={`${name}.${index}.${key}`}
                                  definition={fieldDefinition}
                                  value={row[key]}
                                  onChange={readOnly ? undefined : (v) => setInline(index, key, v)}
                                  readOnly={readOnly}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}

      {readOnly ? null : (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setBrowsing(true)}
            style={{ ...ghostBtn, fontSize: 12, padding: '6px 12px' }}
          >
            <LuSearch size={13} />
            {t('characters.browseCatalog')}
          </button>
          {definition.allow_freeform ? (
            <button
              type="button"
              onClick={addInline}
              style={{ ...ghostBtn, fontSize: 12, padding: '6px 12px' }}
            >
              <LuPencil size={13} />
              {t('characters.addCustom')}
            </button>
          ) : null}
        </div>
      )}

      {browsing ? (
        <ContentBrowser
          schemaId={schemaId}
          contentType={definition.content_type}
          typeDefinition={typeDefinition}
          multiple
          chosen={rows}
          onChoose={add}
          onClose={() => setBrowsing(false)}
        />
      ) : null}
    </div>
  )
}

const inlineEditor = {
  margin: '6px 0 8px',
  padding: 12,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-deep)',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 10,
}

const headCell = {
  // A column heading stays on one line - "Prep" wrapped to "PR / EP" in a
  // column sized to its checkbox.
  whiteSpace: 'nowrap',
  textAlign: 'left',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
  borderBottom: '1px solid var(--border)',
}

const nameButton = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--text)',
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
  width: '100%',
}

function formatCell(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (value === true) return '✓'
  if (value === false) return '—'
  return Array.isArray(value) ? value.join(', ') : String(value)
}

// The one-line summary a row shows beneath its name, from the content type's
// own `compact_display` template.
function summaryOf(entry, typeDefinition) {
  const template = typeDefinition.compact_display
  if (!template) return ''
  return template
    .replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => {
      const value = entry[key]
      if (value === null || value === undefined || value === false) return ''
      if (value === true) return 'yes'
      return Array.isArray(value) ? value.join(', ') : String(value)
    })
    .trim()
}
