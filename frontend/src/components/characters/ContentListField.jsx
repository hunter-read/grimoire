import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuTrash2, LuPencil } from 'react-icons/lu'
import ContentBrowser from './ContentBrowser'
import FieldRenderer from './FieldRenderer'
import { ghostBtn, iconBtn, fieldLabel, card } from './characterStyles'

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
}) {
  const { t } = useTranslation()
  const [browsing, setBrowsing] = useState(false)

  const rows = Array.isArray(value) ? value : []
  const perFields = definition.per_entry_fields || {}
  const hasPerFields = Object.keys(perFields).length > 0

  const add = (picked) => {
    // Picking something already on the sheet is a no-op rather than a duplicate
    // row: two copies of the same spell is never what was meant.
    if (rows.some((row) => row?._ref === picked._ref)) return
    onChange?.([...rows, picked])
  }

  const addInline = () => onChange?.([...rows, { _inline: true, name: '' }])

  const remove = (index) => onChange?.(rows.filter((_, i) => i !== index))

  const setPer = (index, key, cellValue) =>
    onChange?.(
      rows.map((row, i) =>
        i === index ? { ...row, _per: { ...(row._per || {}), [key]: cellValue } } : row
      )
    )

  const setInlineName = (index, text) =>
    onChange?.(rows.map((row, i) => (i === index ? { ...row, name: text } : row)))

  return (
    <div className="gc-content-list">
      {definition.label ? <div style={fieldLabel}>{definition.label}</div> : null}

      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 8px' }}>
          {t('characters.listEmpty')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
          {rows.map((row, index) => {
            const entry = row?._ref ? entries[row._ref] : null
            const missing = !!row?._ref && !entry
            return (
              <li
                key={row?._ref || `inline-${index}`}
                style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, padding: 10 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {row?._inline ? (
                    <FieldRenderer
                      name={`${name}.${index}.name`}
                      definition={{ type: 'text', label: t('characters.customEntry') }}
                      value={row.name}
                      onChange={readOnly ? undefined : (text) => setInlineName(index, text)}
                      readOnly={readOnly}
                      hideLabel
                    />
                  ) : (
                    <>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {entry?.name || row?._ref}
                        {missing ? (
                          <span style={{ color: 'var(--warning)', fontSize: 11, marginLeft: 6 }}>
                            {t('characters.entryMissing')}
                          </span>
                        ) : null}
                      </div>
                      {entry ? (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {summaryOf(entry, typeDefinition)}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {hasPerFields ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                    {Object.entries(perFields).map(([key, perDefinition]) => (
                      <div
                        key={key}
                        style={{ width: perDefinition.type === 'checkbox' ? 'auto' : 70 }}
                      >
                        <FieldRenderer
                          name={`${name}.${index}.${key}`}
                          definition={perDefinition}
                          value={row?._per?.[key]}
                          onChange={readOnly ? undefined : (v) => setPer(index, key, v)}
                          readOnly={readOnly}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}

                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    aria-label={t('characters.removeEntry')}
                    title={t('characters.removeEntry')}
                    style={iconBtn}
                  >
                    <LuTrash2 size={14} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
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
