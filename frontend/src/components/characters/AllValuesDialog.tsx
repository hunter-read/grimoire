import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuSearch } from 'react-icons/lu'
import CharacterSheet from './CharacterSheet'
import type { FieldDefinition } from './FieldRenderer'
import type { SheetDocument } from './LayoutRenderer'
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
interface Props {
  document?: SheetDocument | null
  data?: Record<string, unknown>
  entries?: Record<string, unknown>
  schemaId?: string
  onChange?: (name: string, value: unknown, meta?: unknown) => void
  onReset?: (name: string) => void
  onOverride?: (name: string, value: unknown) => void
  readOnly?: boolean
  onClose?: () => void
}

const HTML_LAYOUT_KEYS = ['layout_ast', 'layout_html', 'mobile_layout_ast', 'mobile_layout_html']

// A computed value may be written as a bare formula string or as `{label, formula}`.
const labelOf = (definition: unknown): string =>
  definition && typeof definition === 'object' && 'label' in definition
    ? String(definition.label || '')
    : ''

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
}: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
    const matches = (name: string, definition: unknown) =>
      !term || name.toLowerCase().includes(term) || labelOf(definition).toLowerCase().includes(term)

    // Every condition dropped: a value hidden by the layout is exactly the one
    // this view exists to reach.
    const fields: Record<string, FieldDefinition> = Object.fromEntries(
      Object.entries(schemaDocument?.fields || {}).map(([name, definition]) => {
        const rest: FieldDefinition = { ...definition }
        delete rest.visible_if
        return [name, rest]
      })
    )
    const computedDefs = schemaDocument?.computed || {}
    const fieldNames = Object.keys(fields).filter((name) => matches(name, fields[name]))
    const computedNames = Object.keys(computedDefs).filter((name) =>
      matches(name, computedDefs[name])
    )
    const layout: { title: string; fields: string[] }[] = []
    if (fieldNames.length) layout.push({ title: t('characters.storedValues'), fields: fieldNames })
    if (computedNames.length) {
      layout.push({ title: t('characters.calculatedValues'), fields: computedNames })
    }
    // Every HTML layout removed - the phone one too - so the plain layout is
    // used whatever the sheet ships and whatever the screen size.
    const rest: SheetDocument = { ...schemaDocument }
    for (const key of HTML_LAYOUT_KEYS) delete rest[key]
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
