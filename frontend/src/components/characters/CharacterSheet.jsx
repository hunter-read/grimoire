import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import FieldRenderer from './FieldRenderer'
import LayoutRenderer from './LayoutRenderer'
import { computeValues, runValidators, buildContext, isVisible } from './expressions'
import { sectionHeading } from './characterStyles'
import ValidatorMessages from './ValidatorMessages'

/**
 * Draws a character against its schema.
 *
 * A schema may describe its sheet two ways, and this picks between them:
 * `layout_ast` (from the author's `layout_html`) when it has one, and the JSON
 * `layout` tree otherwise. The JSON path is what a simple system uses — it
 * produces a clean sectioned sheet with no design work — so shipping a system
 * never *requires* writing HTML.
 *
 * Computed values are recalculated here as you type. The server recomputes them
 * too and is the authority; doing it locally as well is what makes a modifier
 * update the instant its score changes rather than after a round trip.
 */
export default function CharacterSheet({ document: schemaDocument, data, onChange, readOnly }) {
  const { t } = useTranslation()
  const computed = useMemo(() => computeValues(schemaDocument, data || {}), [schemaDocument, data])

  // Validators run locally so the sheet reacts as you type; the server reports
  // them too and is the authority. `visible_if` is evaluated against fields and
  // computed values together, so a block can hinge on a derived number.
  const validators = useMemo(
    () => runValidators(schemaDocument, data || {}),
    [schemaDocument, data]
  )
  const context = useMemo(
    () => ({ ...buildContext(schemaDocument, data || {}), ...computed }),
    [schemaDocument, data, computed]
  )

  if (!schemaDocument) return null

  if (Array.isArray(schemaDocument.layout_ast) && schemaDocument.layout_ast.length) {
    return (
      <>
        <ValidatorMessages results={validators} />
        <LayoutRenderer
          ast={schemaDocument.layout_ast}
          document={schemaDocument}
          data={data}
          computed={computed}
          onChange={onChange}
          readOnly={readOnly}
        />
      </>
    )
  }

  const layout = Array.isArray(schemaDocument.layout) ? schemaDocument.layout : []
  const fields = schemaDocument.fields || {}
  const computedDefs = schemaDocument.computed || {}

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
                const name = typeof entry === 'string' ? entry : entry?.field
                if (!name) return null
                const definition = fields[name]
                if (definition) {
                  if (!isVisible(definition.visible_if, context)) return null
                  // A list wants the full width; a score box does not.
                  const spanAll = definition.type === 'list' || definition.type === 'textarea'
                  return (
                    <div key={name} style={spanAll ? { gridColumn: '1 / -1' } : undefined}>
                      <FieldRenderer
                        name={name}
                        definition={definition}
                        value={data?.[name]}
                        onChange={readOnly ? undefined : (value) => onChange?.(name, value)}
                        readOnly={readOnly}
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
                    />
                  )
                }
                return null
              })}
            </div>
          </section>
        )
      })}

      {Object.keys(computedDefs).length > 0 && !layoutMentionsComputed(layout, computedDefs) ? (
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
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

// A schema that places its computed values itself should not also get the
// automatic "Derived" block underneath.
function layoutMentionsComputed(layout, computedDefs) {
  const names = new Set(Object.keys(computedDefs))
  return layout.some((section) =>
    (section.fields || section.rows || []).some((entry) =>
      names.has(typeof entry === 'string' ? entry : entry?.field)
    )
  )
}
