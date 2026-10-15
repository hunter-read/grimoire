import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuX, LuPencil } from 'react-icons/lu'
import ContentBrowser from './ContentBrowser'
import FieldRenderer from './FieldRenderer'
import { iconBtn, fieldLabel, ghostBtn } from './characterStyles'

/**
 * A single pick from the catalog — a class, an ancestry, a kit.
 *
 * Stores `{_ref, _source}`, never a copy of the entry, so an erratum or a
 * ruleset edit reaches every character that chose it. The entry's own values
 * come from `entries`, which the sheet resolves in one request.
 *
 * `allow_freeform` adds an `_inline` value: something the player types rather
 * than picks. That is the escape hatch that keeps the catalog optional — a
 * homebrew class or species never has to open the browser.
 */
export default function ContentRefField({
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
  const [editingInline, setEditingInline] = useState(false)

  const ref = value && typeof value === 'object' ? value : null
  const inline = !!ref?._inline
  const entry = !inline && ref?._ref ? entries[ref._ref] : null
  // A reference whose entry is not installed still shows what was chosen: the
  // id is what the player picked, and hiding it would look like data loss.
  const display = inline
    ? ref.name || t('characters.customEntry')
    : entry?.name || ref?._ref || ''
  const missing = !inline && !!ref?._ref && !entry

  // The fields a freeform entry can be given - the content type's own, so a
  // custom class keeps a hit die just as a catalog one does.
  const inlineFields = Object.keys(typeDefinition.fields || {}).length
    ? typeDefinition.fields
    : { name: { type: 'text', label: t('characters.name') } }

  const startInline = () => {
    onChange?.({ _inline: true, name: '' }, { entry: null })
    setEditingInline(true)
  }

  const setInline = (key, cellValue) => {
    if (!inline) return
    onChange?.({ ...ref, [key]: cellValue }, { entry: null })
  }

  return (
    <div className="gc-field">
      {hideLabel ? null : <div style={fieldLabel}>{definition.label || name}</div>}

      {inline ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="text"
              value={ref.name || ''}
              onChange={(e) => setInline('name', e.target.value)}
              disabled={readOnly}
              placeholder={t('characters.customEntry')}
              aria-label={definition.label || name}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '6px 9px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg-deep)',
                color: 'var(--text)',
                fontSize: 13,
                minHeight: 32,
                font: 'inherit',
              }}
            />
            {readOnly ? null : (
              <>
                <button
                  type="button"
                  onClick={() => setEditingInline((open) => !open)}
                  aria-expanded={editingInline}
                  aria-label={t(
                    editingInline ? 'characters.hideEntry' : 'characters.showEntry',
                    { name: ref.name || t('characters.customEntry') }
                  )}
                  title={t(
                    editingInline ? 'characters.hideEntry' : 'characters.showEntry',
                    { name: ref.name || t('characters.customEntry') }
                  )}
                  style={{ ...iconBtn, padding: 3 }}
                >
                  <LuPencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange?.(null, { entry: null })
                    setEditingInline(false)
                  }}
                  aria-label={t('characters.clearChoice')}
                  title={t('characters.clearChoice')}
                  style={{ ...iconBtn, padding: 3 }}
                >
                  <LuX size={14} />
                </button>
              </>
            )}
          </div>
          {editingInline && !readOnly ? (
            <div style={inlineEditor}>
              {Object.entries(inlineFields)
                .filter(([key]) => key !== 'name')
                .map(([key, fieldDefinition]) => (
                  <div
                    key={key}
                    style={
                      fieldDefinition.type === 'textarea'
                        ? { gridColumn: '1 / -1' }
                        : undefined
                    }
                  >
                    <FieldRenderer
                      name={`${name}.${key}`}
                      definition={fieldDefinition}
                      value={ref[key]}
                      onChange={(v) => setInline(key, v)}
                    />
                  </div>
                ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {/* The box itself opens the picker. A separate search button beside it
                cost ~40px, and in a row of pickers that squeezed each name until it
                wrapped - "Dragonborn" over two lines. It stays on one line now, and
                the full name is in the tooltip if it has to be cut short. */}
            <button
              type="button"
              onClick={readOnly ? undefined : () => setBrowsing(true)}
              disabled={readOnly}
              aria-label={
                readOnly
                  ? display || definition.label || name
                  : t('characters.chooseEntry', { label: definition.label || name })
              }
              title={display || undefined}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 9px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg-deep)',
                color: display ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 13,
                minHeight: 32,
                textAlign: 'left',
                cursor: readOnly ? 'default' : 'pointer',
                font: 'inherit',
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {display || '—'}
              </span>
              {missing ? (
                <span style={{ color: 'var(--warning)', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {t('characters.entryMissing')}
                </span>
              ) : null}
              {readOnly ? null : <LuSearch size={13} style={{ flexShrink: 0, opacity: 0.6 }} />}
            </button>

            {readOnly || !definition.allow_freeform ? null : (
              <button
                type="button"
                onClick={startInline}
                aria-label={t('characters.addCustom')}
                title={t('characters.addCustom')}
                style={{ ...iconBtn, padding: 3 }}
              >
                <LuPencil size={14} />
              </button>
            )}

            {readOnly || !ref ? null : (
              <button
                type="button"
                onClick={() => onChange?.(null, { entry: null })}
                aria-label={t('characters.clearChoice')}
                title={t('characters.clearChoice')}
                style={{ ...iconBtn, padding: 3 }}
              >
                <LuX size={14} />
              </button>
            )}
          </div>

          {/* When freeform is on and nothing is chosen yet, also offer an explicit
              "Add custom" control — the pencil icon alone is easy to miss in a
              dense header row of species / class / background. */}
          {readOnly || ref || !definition.allow_freeform ? null : (
            <button
              type="button"
              onClick={startInline}
              style={{ ...ghostBtn, fontSize: 12, padding: '4px 8px', marginTop: 4 }}
            >
              <LuPencil size={13} />
              {t('characters.addCustom')}
            </button>
          )}
        </div>
      )}

      {browsing ? (
        <ContentBrowser
          schemaId={schemaId}
          contentType={definition.content_type}
          typeDefinition={typeDefinition}
          chosen={ref && !inline ? [ref] : []}
          onChoose={(picked, chosenEntry) => {
            setEditingInline(false)
            onChange?.(picked, { entry: chosenEntry })
          }}
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
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 10,
}
