import { createElement, Fragment, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import FieldRenderer from './FieldRenderer'
import type { FieldDefinition } from './FieldRenderer'
import { evaluate, isVisible, computedOverrides } from './expressions'
import OverridableValue from './OverridableValue'
import LayoutTabs from './LayoutTabs'
import TierSelect from './TierSelect'
import Pips from './Pips'
import { fieldState } from './onPick'
import SheetPortrait from './SheetPortrait'

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

/** One node of a parsed layout: an element, or a text node. */
export interface LayoutNode {
  tag?: string
  text?: string
  attrs?: Record<string, string>
  children?: LayoutNode[]
}

type Values = Record<string, unknown>

interface ComputedDefinition {
  label?: string
  formula?: string
}

/** The parts of a schema document the layout reads. */
export interface SheetDocument {
  id?: string
  name?: string
  fields?: Record<string, FieldDefinition>
  computed?: Record<string, ComputedDefinition | string>
  content_types?: Record<string, unknown>
  styles_css?: string
  [key: string]: unknown
}

type OnChange = (name: string, value: unknown, meta?: unknown) => void

// Inside a <g-repeat>, the row being drawn: its values, its columns, and how
// to write a cell back.
interface RowScope {
  row: Values
  columns: Record<string, FieldDefinition>
  edit: (key: string, value: unknown) => void
}

// What every node is drawn with, handed down the tree.
interface RenderContext {
  key: string
  schemaDocument?: SheetDocument
  data?: Values
  context: Values
  onChange?: OnChange
  onReset?: (name: string) => void
  onOverride?: (name: string, value: unknown) => void
  overrides: Values
  readOnly: boolean
  entries: Record<string, unknown>
  schemaId?: string
  rowScope?: RowScope
}

interface Props {
  ast?: LayoutNode[] | null
  document?: SheetDocument
  data?: Values
  computed?: Values
  context?: Values
  onChange?: OnChange
  onReset?: (name: string) => void
  onOverride?: (name: string, value: unknown) => void
  readOnly?: boolean
  scope?: string
  entries?: Record<string, unknown>
  schemaId?: string
}

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
  // Collapsible sections. The server allowed these long before this list did,
  // so a sheet's "Other details" was flattened open - its contents drawn with
  // no box and no way to fold them away.
  'details',
  'summary',
])

const DIRECTIVES = new Set([
  'g-field',
  'g-computed',
  'g-label',
  'g-value',
  'g-repeat',
  'g-if',
  'g-section',
  'g-tabs',
  'g-tab',
  'g-option',
  'g-tier',
  'g-pips',
  'g-portrait',
])

// HTML attribute → React prop, for the few that differ.
const PROP_NAMES: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
}

const VOID_TAGS = new Set(['br', 'hr', 'img'])

// Attributes a structural tag may carry, mirroring _GLOBAL_ATTRS and _TAG_ATTRS
// on the server. Anything else - `style`, an `on*` handler, a React-only prop
// such as `dangerouslySetInnerHTML` - is dropped.
const GLOBAL_ATTRS = new Set(['class', 'id', 'title', 'role'])
const TAG_ATTRS: Record<string, Set<string>> = {
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  label: new Set(['for']),
  details: new Set(['open']),
}

// Relative or https, as the server's _check_url allows.
function inertUrl(value: string): boolean {
  const candidate = value.trim().toLowerCase()
  if (!candidate || candidate.startsWith('https://') || candidate.startsWith('/')) return true
  const colon = candidate.indexOf(':')
  return colon === -1 || /[/?#]/.test(candidate.slice(0, colon))
}

function toProps(tag: string, attrs: Record<string, unknown> = {}, key: string) {
  const props: Record<string, unknown> = { key }
  const allowed = TAG_ATTRS[tag]
  for (const [name, value] of Object.entries(attrs)) {
    // Belt and braces: the server parses layouts down to string attributes
    // from a closed list, and so do we.
    if (typeof value !== 'string') continue
    if (name.startsWith('on')) continue
    if (name === 'src' && !inertUrl(value)) continue
    if (name.startsWith('data-') || name.startsWith('aria-')) {
      props[name] = value
      continue
    }
    if (!GLOBAL_ATTRS.has(name) && !allowed?.has(name)) continue
    // A boolean attribute: present means open, whatever its value. React would
    // read `open=""` as false and draw the section closed.
    if (name === 'open') {
      props.open = true
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
  // The sheet's evaluation context: field values with their `default_from`
  // defaults applied, computed values, and the resolved entries. Built from
  // raw data alone, a layout condition would never see a derived value - a
  // Spellcasting panel gated on a class-derived `is_caster` would stay hidden
  // for every wizard.
  context: sheetContext,
  onChange,
  onReset,
  // Overrules a computed value, or with `undefined` hands it back to its
  // formula. The player can override any value on the sheet.
  onOverride,
  readOnly = false,
  scope = 'gc-sheet',
  entries = {},
  schemaId,
}: Props) {
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

  const context = useMemo<Values>(
    () => sheetContext || { ...(data || {}), ...(computed || {}) },
    [sheetContext, data, computed]
  )

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
          onReset,
          onOverride,
          overrides: computedOverrides(schemaDocument, data),
          readOnly,
          entries,
          schemaId,
        })
      )}
    </div>
  )
}

function renderChildren(children: LayoutNode[] | undefined, ctx: RenderContext): ReactNode {
  if (!Array.isArray(children)) return null
  return children.map((child, index) => renderNode(child, { ...ctx, key: `${ctx.key}-${index}` }))
}

function renderNode(node: LayoutNode, ctx: RenderContext): ReactNode {
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

  const props = toProps(tag, node.attrs, ctx.key)
  if (VOID_TAGS.has(tag)) return createElement(tag, props)
  return createElement(tag, props, renderChildren(node.children, ctx))
}

function renderDirective(node: LayoutNode, ctx: RenderContext): ReactNode {
  const {
    schemaDocument,
    data,
    context,
    onChange,
    onReset,
    onOverride,
    overrides = {},
    readOnly,
    key,
    entries,
    schemaId,
  } = ctx
  const attrs: Record<string, string> = node.attrs || {}
  const fields: Record<string, FieldDefinition> = schemaDocument?.fields || {}
  const name = attrs.name

  // `visible_if` hides one directive without wrapping it in a <g-if>, which
  // reads better for a single field. A broken condition shows the element
  // rather than hiding it: losing access to your own data is the worse failure.
  if (!isVisible(attrs.visible_if, context)) return null

  switch (node.tag) {
    case 'g-field': {
      // Inside a <g-repeat>, a name that matches one of the list's columns
      // addresses this row's cell rather than a field on the character.
      const rowScope = ctx.rowScope
      const scoped = rowScope?.columns?.[name]
      if (rowScope && scoped) {
        return (
          <FieldRenderer
            key={key}
            name={name}
            definition={{ ...scoped, ...(attrs.label ? { label: attrs.label } : {}) }}
            value={rowScope.row?.[name]}
            onChange={readOnly ? undefined : (value) => rowScope.edit(name, value)}
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
      const state = fieldState(name, definition, data, context)
      const editable = !readOnly && attrs.readonly === undefined
      return (
        <FieldRenderer
          key={key}
          name={name}
          definition={{ ...definition, ...(attrs.label ? { label: attrs.label } : {}) }}
          value={state.value}
          derived={editable && state.derived}
          onReset={editable && state.overridden && onReset ? () => onReset(name) : undefined}
          onChange={
            readOnly ? undefined : (...args: [unknown, unknown?]) => onChange?.(name, ...args)
          }
          readOnly={readOnly || attrs.readonly !== undefined}
          hideLabel={attrs.label === ''}
          variant={attrs.variant}
          entries={entries}
          schemaId={schemaId || schemaDocument?.id}
          contentTypes={schemaDocument?.content_types || {}}
        />
      )
    }

    case 'g-computed': {
      const definition = computedDefinition(schemaDocument, name)
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
          overridden={name in overrides}
          onOverride={
            !readOnly && attrs.readonly === undefined && onOverride && definition
              ? (value) => onOverride(name, value)
              : undefined
          }
        />
      )
    }

    case 'g-label': {
      const text = attrs.text || fields[name]?.label || name || ''
      return <span key={key}>{text}</span>
    }

    case 'g-value': {
      const value = context?.[name]
      const editable = !readOnly && attrs.readonly === undefined
      const computedField = computedDefinition(schemaDocument, name)
      // A computed value is overridden; a plain text or number field is simply
      // edited in place. Anything else - a list, a reference - stays a display.
      if (editable && computedField && onOverride) {
        return (
          <OverridableValue
            key={key}
            label={computedField.label || name}
            display={formatValue(value)}
            raw={value}
            overridden={name in overrides}
            onOverride={(next: unknown) => onOverride(name, next)}
          />
        )
      }
      const field = fields[name]
      if (editable && field && ['text', 'number'].includes(field.type || 'text') && onChange) {
        const state = fieldState(name, field, data, context)
        return (
          <OverridableValue
            key={key}
            label={field.label || name}
            display={formatValue(value)}
            raw={value}
            overridden={state.overridden}
            onOverride={(next: unknown) => {
              // Clearing a derived field hands it back to its default; clearing
              // a plain one empties it.
              if (next === undefined && state.overridden && onReset) onReset(name)
              else onChange(name, next === undefined ? null : next)
            }}
          />
        )
      }
      return <span key={key}>{formatValue(value)}</span>
    }

    case 'g-if':
      return evaluate(attrs.test, context) ? (
        <Fragment key={key}>{renderChildren(node.children, ctx)}</Fragment>
      ) : null

    case 'g-tabs': {
      // Each child <g-tab> is a page; anything else inside is ignored, as a
      // stray node between pages has nowhere sensible to go.
      const tabs = (node.children || [])
        .filter((child) => child?.tag === 'g-tab')
        .filter((child) => isVisible(child.attrs?.visible_if, context))
        .map((child, index) => ({
          title: child.attrs?.title || String(index + 1),
          content: renderChildren(child.children, { ...ctx, key: `${key}-p${index}` }),
        }))
      return <LayoutTabs key={key} tabs={tabs} scope={key} />
    }

    case 'g-tab':
      // Outside a <g-tabs> a page is just its contents.
      return <Fragment key={key}>{renderChildren(node.children, ctx)}</Fragment>

    case 'g-option': {
      // One option of a multiselect as its own checkbox, so a skill's box can
      // sit beside that skill. The field is still one list.
      const field = fields[attrs.field]
      if (!field || field.type !== 'multiselect' || attrs.value === undefined) return null
      const state = fieldState(attrs.field, field, data, context)
      const list: unknown[] = Array.isArray(state.value) ? state.value : []
      const checked = list.includes(attrs.value)
      const editable = !readOnly && onChange
      const order = optionValues(field)
      const toggle = () => {
        const next = checked ? list.filter((v) => v !== attrs.value) : [...list, attrs.value]
        // Kept in the field's own option order, as the multiselect would.
        onChange?.(
          attrs.field,
          order.filter((option) => next.includes(option))
        )
      }
      return (
        <input
          key={key}
          type="checkbox"
          // The author's class rides along, so a sheet can tell a proficiency box
          // from an expertise box in its stylesheet.
          className={['gc-option', attrs.class].filter(Boolean).join(' ')}
          title={attrs.label || attrs.value}
          // Matched to the app's other checkboxes; without it an option box
          // was the browser's default blue among gold ones.
          style={{ width: 14, height: 14, margin: 0, accentColor: 'var(--gold)' }}
          checked={checked}
          disabled={!editable}
          onChange={editable ? toggle : undefined}
          aria-label={attrs.label || attrs.value}
        />
      )
    }

    case 'g-tier': {
      const ladder = String(attrs.fields || '')
        .split(/\s+/)
        .filter((name) => fields[name]?.type === 'multiselect')
      if (!ladder.length || attrs.value === undefined) return null
      const lists = ladder.map((name): unknown[] => {
        const current = fieldState(name, fields[name], data, context).value
        return Array.isArray(current) ? current : []
      })
      // The highest rung holding the value; expertise alone still reads as
      // expertise, whatever the proficiency list says.
      let level = 0
      lists.forEach((list, index) => {
        if (list.includes(attrs.value)) level = index + 1
      })
      const labels = String(attrs.labels || '').split('|')
      const titles = String(attrs.titles || '').split('|')
      while (labels.length < ladder.length + 1) labels.push(String(labels.length))
      const editable = !readOnly && onChange
      const choose = (next: number) => {
        ladder.forEach((name, index) => {
          const order = optionValues(fields[name])
          const has = lists[index].includes(attrs.value)
          const want = index < next
          if (has === want) return
          const updated = want
            ? [...lists[index], attrs.value]
            : lists[index].filter((v) => v !== attrs.value)
          onChange?.(
            name,
            order.filter((option) => updated.includes(option))
          )
        })
      }
      return (
        <TierSelect
          key={key}
          level={level}
          labels={labels}
          titles={titles}
          label={attrs.label || attrs.value}
          disabled={!editable}
          onChange={editable ? choose : undefined}
        />
      )
    }

    case 'g-pips': {
      // `count` is a number, or a field or computed value holding one.
      const count = /^\d+$/.test(String(attrs.count || ''))
        ? Number(attrs.count)
        : Number(context?.[attrs.count]) || 0
      const usedField = fields[attrs.value]
      const used = usedField
        ? Number(fieldState(attrs.value, usedField, data, context).value) || 0
        : 0
      const editable = Boolean(!readOnly && onChange && usedField)
      return (
        <Pips
          key={key}
          count={count}
          used={used}
          label={attrs.label || attrs.value || ''}
          disabled={!editable}
          onChange={editable ? (next: number) => onChange?.(attrs.value, next) : undefined}
        />
      )
    }

    case 'g-portrait':
      // The character's own art, not a field's: the sheet only says where.
      return <SheetPortrait key={key} className={attrs.class} />

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
      const rows: unknown = data?.[listName]
      if (!Array.isArray(rows)) return null

      const listDefinition = fields[listName] || {}
      const columns = (listDefinition.columns || []) as FieldDefinition[]
      // Inside a repeat, a <g-field name="qty"/> means *this row's* qty. The
      // row's columns therefore shadow the character's own fields, and an edit
      // is written back into the row rather than to a top-level field.
      const columnsByKey: Record<string, FieldDefinition> = Object.fromEntries(
        columns.map((column) => [column.key, column])
      )

      return (
        <Fragment key={key}>
          {rows.map((row: Values | null, index: number) => {
            const editRow = (columnKey: string, cellValue: unknown) => {
              const next = rows.map((existing: Values, i: number) =>
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

function computedDefinition(
  schemaDocument: SheetDocument | undefined,
  name: string
): ComputedDefinition | undefined {
  const definition = schemaDocument?.computed?.[name]
  if (definition === undefined) return undefined
  // A computed value may be written as its bare formula.
  return typeof definition === 'string' ? { formula: definition } : definition
}

function optionValues(field: FieldDefinition) {
  return (field.options || []).map((option) =>
    option && typeof option === 'object' ? option.value : option
  )
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (value === true) return '✓'
  if (value === false) return '—'
  return String(value)
}
