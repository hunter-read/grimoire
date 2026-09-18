import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import FieldRenderer from './FieldRenderer'
import LayoutRenderer from './LayoutRenderer'
import { computeValues } from './expressions'
import { sectionHeading } from './characterStyles'

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

  if (!schemaDocument) return null

  if (Array.isArray(schemaDocument.layout_ast) && schemaDocument.layout_ast.length) {
    return (
      <LayoutRenderer
        ast={schemaDocument.layout_ast}
        document={schemaDocument}
        data={data}
        computed={computed}
        onChange={onChange}
        readOnly={readOnly}
      />
    )
  }

  const layout = Array.isArray(schemaDocument.layout) ? schemaDocument.layout : []
  const fields = schemaDocument.fields || {}
  const computedDefs = schemaDocument.computed || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {layout.map((section, index) => (
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
                return (
                  <FieldRenderer
                    key={name}
                    name={name}
                    definition={definition}
                    value={data?.[name]}
                    onChange={readOnly ? undefined : (value) => onChange?.(name, value)}
                    readOnly={readOnly}
                  />
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
      ))}

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
