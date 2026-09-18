import { createElement, Fragment, useEffect, useMemo } from 'react'
import FieldRenderer from './FieldRenderer'
import { evaluate, isVisible } from './expressions'

/**
 * Renders a schema's `layout_ast` — the parsed, allowlisted form of its
 * `layout_html` — as React elements.
 *
 * The security property this file exists to preserve: **nothing a schema wrote
 * is ever inserted as HTML**. The server parses `layout_html` into a plain-JSON
 * AST (backend/services/characters/layout_html.py), and this walks that AST
 * calling `createElement` with an allowlisted tag name. There is no
 * `dangerouslySetInnerHTML` anywhere in the character system, so a hostile
 * schema has no markup-injection surface to aim at — by the time a layout
 * renders, it is data, not markup.
 *
 * The allowlist is re-applied here rather than trusted from the server: the
 * same defence-in-depth rule the theme system follows for colour tokens, which
 * matters more here because a layout carries structure.
 *
 * Interactive widgets are always real components. `<g-field>` renders a
 * FieldRenderer; a schema cannot write an `<input>` of its own, so it cannot
 * forge a control that looks like part of the app.
 */

// Structural tags a layout may draw with, mirroring ALLOWED_TAGS on the server.
const ALLOWED_TAGS = new Set([
  'div',
  'span',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'small',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'figure',
  'figcaption',
  'img',
  'fieldset',
  'legend',
  'label',
])

const DIRECTIVES = new Set([
  'g-field',
  'g-computed',
  'g-label',
  'g-value',
  'g-repeat',
  'g-if',
  'g-section',
])

// HTML attribute → React prop, for the few that differ.
const PROP_NAMES = { class: 'className', for: 'htmlFor', colspan: 'colSpan', rowspan: 'rowSpan' }

const VOID_TAGS = new Set(['br', 'hr', 'img'])

function toProps(attrs = {}, key) {
  const props = { key }
  for (const [name, value] of Object.entries(attrs)) {
    // Belt and braces: the server rejects these, and so do we.
    if (name.startsWith('on')) continue
    if (name === 'style') continue
    if (name.startsWith('data-') || name.startsWith('aria-')) {
      props[name] = value
      continue
    }
    props[PROP_NAMES[name] || name] = value
  }
  return props
}

export default function LayoutRenderer({
  ast,
  document: schemaDocument,
  data,
  computed,
  onChange,
  readOnly = false,
  scope = 'gc-sheet',
}) {
  const css = schemaDocument?.styles_css

  // The app's CSP forbids inline <style>, so a schema's stylesheet is attached
  // as a real stylesheet element scoped by class. Removed on unmount so leaving
  // one sheet cannot restyle the next.
  useEffect(() => {
    if (!css) return undefined
    const element = window.document.createElement('style')
    element.setAttribute('data-character-sheet', scope)
    element.textContent = css
    window.document.head.appendChild(element)
    return () => element.remove()
  }, [css, scope])

  const context = useMemo(() => ({ ...(data || {}), ...(computed || {}) }), [data, computed])

  if (!Array.isArray(ast)) return null

  return (
    <div className={scope}>
      {ast.map((node, index) =>
        renderNode(node, {
          key: `n${index}`,
          schemaDocument,
          data,
          context,
          onChange,
          readOnly,
        })
      )}
    </div>
  )
}

function renderChildren(children, ctx) {
  if (!Array.isArray(children)) return null
  return children.map((child, index) => renderNode(child, { ...ctx, key: `${ctx.key}-${index}` }))
}

function renderNode(node, ctx) {
  if (!node || typeof node !== 'object') return null

  // A text node.
  if (typeof node.text === 'string') return node.text

  const tag = node.tag
  if (!tag) return null

  if (DIRECTIVES.has(tag)) return renderDirective(node, ctx)

  if (!ALLOWED_TAGS.has(tag)) {
    // Unknown tag: render its children rather than dropping the subtree, so a
    // layout written against a newer schema version degrades to something
    // readable instead of a hole.
    return <Fragment key={ctx.key}>{renderChildren(node.children, ctx)}</Fragment>
  }

  const props = toProps(node.attrs, ctx.key)
  if (VOID_TAGS.has(tag)) return createElement(tag, props)
  return createElement(tag, props, renderChildren(node.children, ctx))
}

function renderDirective(node, ctx) {
  const { schemaDocument, data, context, onChange, readOnly, key } = ctx
  const attrs = node.attrs || {}
  const fields = schemaDocument?.fields || {}
  const name = attrs.name

  // `visible_if` hides one directive without wrapping it in a <g-if>, which
  // reads better for a single field. A broken condition shows the element
  // rather than hiding it: losing access to your own data is the worse failure.
  if (!isVisible(attrs.visible_if, context)) return null

  switch (node.tag) {
    case 'g-field': {
      // Inside a <g-repeat>, a name that matches one of the list's columns
      // addresses this row's cell rather than a field on the character.
      const scoped = ctx.rowScope?.columns?.[name]
      if (scoped) {
        return (
          <FieldRenderer
            key={key}
            name={name}
            definition={{ ...scoped, ...(attrs.label ? { label: attrs.label } : {}) }}
            value={ctx.rowScope.row?.[name]}
            onChange={readOnly ? undefined : (value) => ctx.rowScope.edit(name, value)}
            readOnly={readOnly || attrs.readonly !== undefined}
            hideLabel={attrs.label === ''}
          />
        )
      }

      const definition = fields[name]
      // A layout naming a field the schema does not declare renders nothing
      // rather than an error box: the schema validator already rejects this at
      // install, so reaching here means a stored document drifted.
      if (!definition) return null
      // A field declaring its own condition honours it wherever it is drawn, so
      // a schema does not have to repeat the condition in every layout.
      if (!isVisible(definition.visible_if, context)) return null
      return (
        <FieldRenderer
          key={key}
          name={name}
          definition={{ ...definition, ...(attrs.label ? { label: attrs.label } : {}) }}
          value={data?.[name]}
          onChange={readOnly ? undefined : (value) => onChange?.(name, value)}
          readOnly={readOnly || attrs.readonly !== undefined}
          hideLabel={attrs.label === ''}
        />
      )
    }

    case 'g-computed': {
      const definition = schemaDocument?.computed?.[name]
      return (
        <FieldRenderer
          key={key}
          name={name}
          definition={{
            type: 'text',
            label: attrs.label ?? definition?.label ?? name,
          }}
          value={context?.[name]}
          readOnly
          hideLabel={attrs.label === ''}
        />
      )
    }

    case 'g-label': {
      const text = attrs.text || fields[name]?.label || name || ''
      return <span key={key}>{text}</span>
    }

    case 'g-value':
      return <span key={key}>{formatValue(context?.[name])}</span>

    case 'g-if':
      return evaluate(attrs.test, context) ? (
        <Fragment key={key}>{renderChildren(node.children, ctx)}</Fragment>
      ) : null

    case 'g-section':
      return (
        <section key={key} className="gc-section" data-section={attrs.name || undefined}>
          {attrs.title ? <h3>{attrs.title}</h3> : null}
          {renderChildren(node.children, ctx)}
        </section>
      )

    case 'g-repeat': {
      // Iterates a `list` field's rows. A repeat over anything that is not a
      // list renders nothing rather than erroring — the schema validator has
      // already checked the field exists.
      const listName = attrs.over
      const rows = data?.[listName]
      if (!Array.isArray(rows)) return null

      const listDefinition = fields[listName] || {}
      const columns = listDefinition.columns || []
      // Inside a repeat, a <g-field name="qty"/> means *this row's* qty. The
      // row's columns therefore shadow the character's own fields, and an edit
      // is written back into the row rather than to a top-level field.
      const columnsByKey = Object.fromEntries(columns.map((column) => [column.key, column]))

      return (
        <Fragment key={key}>
          {rows.map((row, index) => {
            const editRow = (columnKey, cellValue) => {
              const next = rows.map((existing, i) =>
                i === index ? { ...existing, [columnKey]: cellValue } : existing
              )
              onChange?.(listName, next)
            }
            return renderChildren(node.children, {
              ...ctx,
              key: `${key}-${index}`,
              context: { ...context, ...(row || {}), _index: index },
              rowScope: { row: row || {}, columns: columnsByKey, edit: editRow },
            })
          })}
        </Fragment>
      )
    }

    default:
      return null
  }
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (value === true) return '✓'
  if (value === false) return '—'
  return String(value)
}
