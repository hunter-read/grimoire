import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuSearch } from 'react-icons/lu'
import CharacterSheet from './CharacterSheet'
import {
  iconBtn,
  fieldInput,
  scrim,
  modalPanel,
  modalHeader,
  modalBody,
  helpText,
} from './characterStyles'

/**
 * Every value a character stores, and every value its sheet calculates, in one
 * plain list - whatever the sheet's own layout chooses to show.
 *
 * The rule for the builder is that the player can set any value. A sheet's
 * layout is written by whoever wrote the sheet, and one that leaves a field out,
 * or hides it behind a condition, would otherwise leave that value out of reach.
 * This is the backstop: it draws the same character through the plain sectioned
 * layout, so fields keep their automatic markers and resets and calculated
 * values stay overridable, with no condition hiding anything.
 */
export default function AllValuesDialog({
  document: schemaDocument,
  data,
  entries,
  schemaId,
  onChange,
  onReset,
  onOverride,
  readOnly = false,
  onClose,
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The sheet redrawn with a generated layout. Computed definitions are kept
  // whole - a filter that dropped one would break every value built on it - and
  // only the layout is narrowed.
  const plain = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matches = (name, definition) =>
      !term ||
      name.toLowerCase().includes(term) ||
      String(definition?.label || '')
        .toLowerCase()
        .includes(term)

    // Every condition dropped: a value hidden by the layout is exactly the one
    // this view exists to reach.
    const fields = Object.fromEntries(
      Object.entries(schemaDocument?.fields || {}).map(([name, definition]) => {
        const { visible_if: _hidden, ...rest } = definition || {}
        return [name, rest]
      })
    )
    const fieldNames = Object.keys(fields).filter((name) => matches(name, fields[name]))
    const computedNames = Object.keys(schemaDocument?.computed || {}).filter((name) =>
      matches(name, schemaDocument.computed[name])
    )
    const layout = []
    if (fieldNames.length) layout.push({ title: t('characters.storedValues'), fields: fieldNames })
    if (computedNames.length) {
      layout.push({ title: t('characters.calculatedValues'), fields: computedNames })
    }
    // `layout_ast` removed so the plain layout is used whatever the sheet ships.
    const { layout_ast: _ast, layout_html: _html, ...rest } = schemaDocument || {}
    return { document: { ...rest, fields, layout }, empty: !layout.length }
  }, [schemaDocument, search, t])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('characters.allValues')}
      style={scrim}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div style={modalPanel}>
        <header style={{ ...modalHeader, paddingBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>{t('characters.allValues')}</h2>
          <button onClick={onClose} aria-label={t('common.close')} style={iconBtn}>
            <LuX size={18} />
          </button>
        </header>
        <div style={{ padding: '0 20px' }}>
          <p style={{ ...helpText, marginTop: 0 }}>{t('characters.allValuesHelp')}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <LuSearch size={15} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('characters.searchValues')}
              aria-label={t('characters.searchValues')}
              style={{ ...fieldInput, flex: 1 }}
            />
          </div>
        </div>
        <div style={modalBody}>
          {plain.empty ? (
            <p style={{ color: 'var(--text-muted)' }}>{t('characters.noValuesMatch')}</p>
          ) : (
            <CharacterSheet
              document={plain.document}
              data={data}
              entries={entries}
              schemaId={schemaId}
              onChange={onChange}
              onReset={onReset}
              onOverride={onOverride}
              readOnly={readOnly}
              showUnplacedComputed={false}
            />
          )}
        </div>
      </div>
    </div>
  )
}
