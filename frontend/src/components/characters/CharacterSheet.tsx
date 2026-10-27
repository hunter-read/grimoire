import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import FieldRenderer from './FieldRenderer'
import type { FieldDefinition } from './FieldRenderer'
import LayoutRenderer from './LayoutRenderer'
import type { SheetDocument } from './LayoutRenderer'
import {
  computeValues,
  runValidators,
  buildContext,
  isVisible,
  computedOverrides,
} from './expressions'
import { sectionHeading } from './characterStyles'
import ValidatorMessages from './ValidatorMessages'
import { fieldState } from './onPick'
import { forViewport, usePhoneViewport } from './phoneLayout'

type Values = Record<string, unknown>

// One entry in a JSON layout section: a field's name, or `{field: name}`.
type LayoutEntry = string | { field?: string } | null | undefined

interface LayoutSection {
  title?: string
  visible_if?: string
  fields?: LayoutEntry[]
  rows?: LayoutEntry[]
}

interface ComputedDefinition {
  label?: string
  formula?: string
}

interface Props {
  document?: SheetDocument | null
  data?: Values
  onChange?: (name: string, value: unknown, meta?: unknown) => void
  onReset?: (name: string) => void
  onOverride?: (name: string, value: unknown) => void
  showUnplacedComputed?: boolean
  readOnly?: boolean
  entries?: Record<string, unknown>
  schemaId?: string
}

/**
 * Draws a character against its schema.
 *
 * A schema may describe its sheet two ways, and this picks between them:
 * `layout_ast` (from the author's `layout_html`) when it has one, and the JSON
 * `layout` tree otherwise. The JSON path is what a simple system uses — it
 * produces a clean sectioned sheet with no design work — so shipping a system
 * never *requires* writing HTML. On a phone-sized screen a sheet that also
 * ships `mobile_layout_ast` is drawn with that instead, with its own
 * stylesheet (see phoneLayout.ts).
 *
 * Computed values are recalculated here as you type. The server recomputes them
 * too and is the authority; doing it locally as well is what makes a modifier
 * update the instant its score changes rather than after a round trip.
 */
export default function CharacterSheet({
  document: schemaDocument,
  data,
  onChange,
  // Hands a field back to its `default_from` value after the player typed over
  // it. Only fields with a `default_from` ever offer it.
  onReset,
  // Overrules a computed value, or with `undefined` returns it to its formula.
  // The player can override any value on the sheet.
  onOverride,
  // Whether computed values the layout does not place get a section of their
  // own. The all-values view places exactly the ones it means to show.
  showUnplacedComputed = true,
  readOnly,
  // Catalog entries this character's references point at, resolved once by the
  // detail view so no field has to fetch its own.
  entries = {},
  schemaId,
}: Props) {
  const { t } = useTranslation()
  // The phone layout, when the sheet has one and the screen is phone-sized,
  // stands in for the desktop one. Values and validators are the same
  // whichever layout draws them.
  const phone = usePhoneViewport()
  const layoutDocument = useMemo(() => forViewport(schemaDocument, phone), [schemaDocument, phone])
  // Entries ride in the evaluation context so `sum_refs(spells, 'level')` can
  // read a referenced entry's own properties.
  const withEntries = useMemo<Values>(
    () => (Object.keys(entries).length ? { ...(data || {}), _entries: entries } : data || {}),
    [data, entries]
  )
  const computed = useMemo<Values>(
    () => computeValues(schemaDocument, withEntries),
    [schemaDocument, withEntries]
  )

  // Validators run locally so the sheet reacts as you type; the server reports
  // them too and is the authority. `visible_if` is evaluated against fields and
  // computed values together, so a block can hinge on a derived number.
  const validators = useMemo(
    () => runValidators(schemaDocument, withEntries),
    [schemaDocument, withEntries]
  )
  const context = useMemo<Values>(
    () => ({ ...buildContext(schemaDocument, withEntries), ...computed }),
    [schemaDocument, withEntries, computed]
  )

  if (!schemaDocument || !layoutDocument) return null

  const overrides: Values = computedOverrides(schemaDocument, data)
  const overrideProps = (name: string) =>
    !readOnly && onOverride
      ? {
          overridden: name in overrides,
          onOverride: (value: unknown) => onOverride(name, value),
        }
      : {}

  if (Array.isArray(layoutDocument.layout_ast) && layoutDocument.layout_ast.length) {
    return (
      <>
        <ValidatorMessages results={validators} />
        <LayoutRenderer
          ast={layoutDocument.layout_ast}
          document={layoutDocument}
          data={data}
          computed={computed}
          context={context}
          onChange={onChange}
          onReset={onReset}
          onOverride={onOverride}
          readOnly={readOnly}
          entries={entries}
          schemaId={schemaId}
        />
      </>
    )
  }

  const layout: LayoutSection[] = Array.isArray(schemaDocument.layout)
    ? (schemaDocument.layout as LayoutSection[])
    : []
  const fields: Record<string, FieldDefinition> = schemaDocument.fields || {}
  const computedDefs = (schemaDocument.computed || {}) as Record<string, ComputedDefinition>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <ValidatorMessages results={validators} />
      {layout.map((section, index) => {
        // A whole section can hinge on a condition — a spellcasting block for
        // casters only — so it is checked before anything in it is drawn.
        if (!isVisible(section.visible_if, context)) return null
        return (
          <section key={section.title || index}>
            {section.title ? <h3 style={sectionHeading}>{section.title}</h3> : null}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              {(section.fields || section.rows || []).map((entry) => {
                const name = entryName(entry)
                if (!name) return null
                const definition = fields[name]
                if (definition) {
                  if (!isVisible(definition.visible_if, context)) return null
                  // A list wants the full width; a score box does not.
                  const spanAll =
                    definition.type === 'list' ||
                    definition.type === 'textarea' ||
                    definition.type === 'content_list'
                  const state = fieldState(name, definition, data, context)
                  return (
                    <div key={name} style={spanAll ? { gridColumn: '1 / -1' } : undefined}>
                      <FieldRenderer
                        name={name}
                        definition={definition}
                        value={state.value}
                        derived={!readOnly && state.derived}
                        onReset={
                          !readOnly && state.overridden && onReset ? () => onReset(name) : undefined
                        }
                        onChange={
                          readOnly
                            ? undefined
                            : (...args: [unknown, unknown?]) => onChange?.(name, ...args)
                        }
                        readOnly={readOnly}
                        entries={entries}
                        schemaId={schemaId || schemaDocument.id}
                        contentTypes={schemaDocument.content_types || {}}
                      />
                    </div>
                  )
                }
                // A computed value may be placed in the layout too.
                if (computedDefs[name]) {
                  return (
                    <FieldRenderer
                      key={name}
                      name={name}
                      definition={{ type: 'text', label: computedDefs[name].label || name }}
                      value={computed[name]}
                      readOnly
                      {...overrideProps(name)}
                    />
                  )
                }
                return null
              })}
            </div>
          </section>
        )
      })}

      {showUnplacedComputed &&
      Object.keys(computedDefs).length > 0 &&
      !layoutMentionsComputed(layout, computedDefs) ? (
        <section>
          <h3 style={sectionHeading}>{t('characters.derived')}</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            {Object.entries(computedDefs).map(([name, definition]) => (
              <FieldRenderer
                key={name}
                name={name}
                definition={{ type: 'text', label: definition.label || name }}
                value={computed[name]}
                readOnly
                {...overrideProps(name)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function entryName(entry: LayoutEntry): string | undefined {
  return typeof entry === 'string' ? entry : entry?.field
}

// A schema that places its computed values itself should not also get the
// automatic "Derived" block underneath.
function layoutMentionsComputed(
  layout: LayoutSection[],
  computedDefs: Record<string, ComputedDefinition>
): boolean {
  const names = new Set(Object.keys(computedDefs))
  return layout.some((section) =>
    (section.fields || section.rows || []).some((entry) => {
      const name = entryName(entry)
      return name !== undefined && names.has(name)
    })
  )
}
