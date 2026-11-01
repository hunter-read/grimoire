import { describe, it, expect } from 'vitest'
import { hiddenFields, visibleValidators } from './validatorVisibility'
import type { LayoutNode, SheetDocument } from './LayoutRenderer'

const fields = {
  open: { type: 'checkbox' },
  dc: { type: 'number' },
  other: { type: 'number' },
}

const withAst = (layout_ast: LayoutNode[]): SheetDocument => ({ fields, layout_ast })
const hidden = (doc: SheetDocument, context: Record<string, unknown> = { open: false }) => [
  ...hiddenFields(doc, doc, context),
]

describe('hiddenFields', () => {
  it('counts a field whose own visible_if is false, whatever the layout', () => {
    const doc = { fields: { ...fields, dc: { type: 'number', visible_if: 'open' } } }
    expect(hidden(doc)).toEqual(['dc'])
    expect(hidden(doc, { open: true })).toEqual([])
  })

  it('keeps a field shown when its condition cannot be evaluated', () => {
    const doc = { fields: { dc: { type: 'number', visible_if: 'nope(' } } }
    expect(hidden(doc)).toEqual([])
  })

  it('counts a field inside a hidden section of a JSON layout', () => {
    const doc = {
      fields,
      layout: [
        { title: 'Main', fields: ['open'] },
        { title: 'Spells', visible_if: 'open', fields: [{ field: 'dc' }] },
      ],
    }
    expect(hidden(doc)).toEqual(['dc'])
  })

  it('counts a field inside a false <g-if> or a hidden directive', () => {
    expect(
      hidden(
        withAst([
          {
            tag: 'g-if',
            attrs: { test: 'open' },
            children: [{ tag: 'g-field', attrs: { name: 'dc' } }],
          },
          { tag: 'g-field', attrs: { name: 'other', visible_if: 'open' } },
        ])
      ).sort()
    ).toEqual(['dc', 'other'])
  })

  it('treats a field as shown if any one placement is', () => {
    const doc = withAst([
      {
        tag: 'g-section',
        attrs: { visible_if: 'open' },
        children: [{ tag: 'g-field', attrs: { name: 'dc' } }],
      },
      { tag: 'g-value', attrs: { name: 'dc' } },
    ])
    expect(hidden(doc)).toEqual([])
  })

  it('reads the field each directive draws', () => {
    const tab = (children: LayoutNode[]): LayoutNode => ({
      tag: 'g-tab',
      attrs: { visible_if: 'open' },
      children,
    })
    const doc = withAst([
      {
        tag: 'g-tabs',
        children: [
          tab([
            { tag: 'g-option', attrs: { field: 'skills', value: 'x' } },
            { tag: 'g-tier', attrs: { fields: 'trained expert', value: 'x' } },
            { tag: 'g-pips', attrs: { count: '3', value: 'used' } },
            { tag: 'g-repeat', attrs: { over: 'gear' } },
          ]),
        ],
      },
    ])
    expect(hidden(doc).sort()).toEqual(['expert', 'gear', 'skills', 'trained', 'used'])
  })

  it('does not judge conditions inside a repeat, which read the row', () => {
    const doc = withAst([
      {
        tag: 'g-repeat',
        attrs: { over: 'gear' },
        children: [
          {
            tag: 'g-if',
            attrs: { test: 'equipped' },
            children: [{ tag: 'g-field', attrs: { name: 'dc' } }],
          },
        ],
      },
    ])
    expect(hidden(doc)).toEqual([])
  })

  it('does not count a field the layout never places', () => {
    const doc = withAst([{ tag: 'g-field', attrs: { name: 'open' } }])
    expect(hidden(doc)).toEqual([])
  })

  it('walks the layout being drawn, not the schema document', () => {
    const schema = withAst([{ tag: 'g-field', attrs: { name: 'dc', visible_if: 'open' } }])
    const phone = withAst([{ tag: 'g-field', attrs: { name: 'dc' } }])
    expect([...hiddenFields(schema, phone, { open: false })]).toEqual([])
  })
})

describe('visibleValidators', () => {
  const results = [
    { rule: 'a', field: 'dc', message: 'on dc' },
    { rule: 'b', field: null, message: 'sheet-wide' },
    { rule: 'c', field: 'other', message: 'on other' },
  ]

  it('drops only the ones attached to a hidden field', () => {
    expect(visibleValidators(results, new Set(['dc'])).map((r) => r.message)).toEqual([
      'sheet-wide',
      'on other',
    ])
  })

  it('returns everything when nothing is hidden', () => {
    expect(visibleValidators(results, new Set())).toBe(results)
  })
})
