import { describe, it, expect } from 'vitest'
import { actionPrompts, findAction, planAction, MAX_LIST_ROWS } from './sheetActions'
import type { SheetAction } from './sheetActions'

const DOCUMENT = {
  fields: {
    hp: { type: 'number' },
    hp_max: { type: 'number' },
    exhaustion: { type: 'number' },
    resources: {
      type: 'list',
      columns: [
        { key: 'name', type: 'text' },
        { key: 'used', type: 'number' },
        { key: 'recovery', type: 'text' },
      ],
    },
    items: {
      type: 'content_list',
      content_type: 'item',
      per_entry_fields: { charges_used: { type: 'number' } },
    },
  },
}

const DATA = {
  hp: 3,
  hp_max: 20,
  exhaustion: 3,
  resources: [
    { name: 'Rage', used: 2, recovery: 'long' },
    { name: 'Ki', used: 4, recovery: 'short' },
  ],
  items: [
    { _ref: 'wand', _per: { charges_used: 5 } },
    { _ref: 'rope', _per: { charges_used: 1 } },
    { _inline: true, name: 'Homebrew staff', charges: 3, _per: { charges_used: 2 } },
  ],
}

const ENTRIES = { wand: { name: 'Wand', charges: 7 }, rope: { name: 'Rope', charges: 0 } }

const plan = (steps: SheetAction['steps'], data: Record<string, unknown> = DATA) =>
  planAction(
    { name: 'a', label: 'A', steps },
    { document: DOCUMENT, data, context: { ...data }, entries: ENTRIES }
  )

describe('planAction', () => {
  it('sets a field from a formula read when the button is pressed', () => {
    expect(
      plan([
        { set: 'hp', to: 'hp_max' },
        { set: 'exhaustion', to: 'max(0, exhaustion - 2)' },
      ])
    ).toEqual({ hp: 20, exhaustion: 1 })
  })

  it('writes the columns of the rows `where` picks, reading each as `row`', () => {
    const patch = plan([
      { each: 'resources', where: "row.recovery == 'short'", set: { used: '0' } },
    ])
    expect(patch.resources).toEqual([
      { name: 'Rage', used: 2, recovery: 'long' },
      { name: 'Ki', used: 0, recovery: 'short' },
    ])
  })

  it('writes every row without `where`', () => {
    const patch = plan([{ each: 'resources', set: { used: 'row.used - 1' } }])
    expect((patch.resources as { used: number }[]).map((row) => row.used)).toEqual([1, 3])
  })

  it('reads a content_list row as the entry with its per-entry values on top', () => {
    const patch = plan([{ each: 'items', where: 'row.charges > 0', set: { charges_used: '0' } }])
    expect(patch.items).toEqual([
      { _ref: 'wand', _per: { charges_used: 0 } },
      { _ref: 'rope', _per: { charges_used: 1 } },
      { _inline: true, name: 'Homebrew staff', charges: 3, _per: { charges_used: 0 } },
    ])
  })

  it('leaves a list out of the patch when no row changes', () => {
    expect(
      plan([{ each: 'resources', where: "row.recovery == 'never'", set: { used: '0' } }])
    ).toEqual({})
  })

  it('appends a row to a list', () => {
    const patch = plan([{ append: 'resources', values: { name: "'Luck'", used: 'hp_max - 20' } }])
    expect((patch.resources as unknown[]).at(-1)).toEqual({ name: 'Luck', used: 0 })
  })

  it('applies steps on the same list in turn', () => {
    const patch = plan([
      { append: 'resources', values: { name: "'Luck'", used: '3', recovery: "'long'" } },
      { each: 'resources', where: "row.recovery == 'long'", set: { used: '0' } },
    ])
    expect((patch.resources as { used: number }[]).map((row) => row.used)).toEqual([0, 4, 0])
  })

  it('skips a write whose formula cannot be worked out', () => {
    expect(plan([{ set: 'hp', to: 'nowhere(' }])).toEqual({})
  })

  it('does not append past the most rows a list may hold', () => {
    const full = { ...DATA, resources: Array.from({ length: MAX_LIST_ROWS }, () => ({ used: 1 })) }
    expect(plan([{ append: 'resources', values: { used: '0' } }], full)).toEqual({})
  })

  it('ignores a step on a field the sheet does not have', () => {
    expect(
      plan([
        { set: 'missing', to: '1' },
        { each: 'hp', set: { used: '0' } },
      ])
    ).toEqual({})
  })
})

describe('findAction', () => {
  it('finds an action by name', () => {
    const action = { name: 'rest', label: 'Rest', steps: [] }
    expect(findAction({ actions: [action] }, 'rest')).toBe(action)
    expect(findAction({ actions: [action] }, 'other')).toBeUndefined()
    expect(findAction({}, 'rest')).toBeUndefined()
  })
})

describe('actionPrompts', () => {
  it('lists the prompts an action opens, in order, and writes nothing for them', () => {
    const action: SheetAction = {
      name: 'gain',
      label: 'Gain',
      steps: [{ prompt: 'level_up' }, { set: 'level', to: '2' }, { prompt: 'spells' }],
    }
    expect(actionPrompts(action)).toEqual(['level_up', 'spells'])
    expect(
      planAction(action, {
        document: { fields: { level: { type: 'number' } } },
        data: {},
        context: {},
      })
    ).toEqual({ level: 2 })
    expect(actionPrompts(undefined)).toEqual([])
  })
})
