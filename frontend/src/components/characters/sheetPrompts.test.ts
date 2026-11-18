import { describe, it, expect } from 'vitest'
import {
  findPrompt,
  isComplete,
  loadEntryOptions,
  matchesPattern,
  numberAverage,
  numberDefault,
  pendingPrompts,
  planGrants,
  planPrompt,
  stepOptions,
  stepPatterns,
  visibleAnswers,
  visibleSteps,
  withPending,
  withoutPending,
  withoutPendingFrom,
} from './sheetPrompts'
import type { PromptStep, SheetPrompt } from './sheetPrompts'

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha']

const LEVEL_UP: SheetPrompt = {
  label: 'Level up',
  steps: [
    {
      key: 'hp',
      type: 'number',
      label: 'Hit points',
      default: '0',
      average: 'hit_die / 2 + 1',
      min: 0,
    },
    {
      key: 'kind',
      type: 'select',
      options: [
        { value: 'asi', label: 'Ability Score Improvement' },
        { value: 'feat', label: 'Feat' },
      ],
      visible_if: 'level + 1 == 4',
    },
    {
      key: 'asi',
      type: 'distribute',
      options: ABILITIES,
      patterns: ['2', '1,1'],
      visible_if: "answer.kind == 'asi'",
    },
    {
      key: 'feat',
      type: 'entry',
      content_type: 'feat',
      filters: { category: 'General' },
      filter: 'entry.level <= level + 1',
      visible_if: "answer.kind == 'feat'",
    },
  ],
  apply: [
    { set: 'level', to: 'level + 1' },
    { set: 'hp_max', to: 'hp_max + answer.hp' },
    { set: 'str', to: 'str + answer.asi.str' },
    { append: 'advancements', values: { level: 'level + 1', hp: 'answer.hp' } },
    { pick: 'feats', entry: 'answer.feat', values: { from_level: 'level + 1' } },
    { prompt: 'spells' },
  ],
}

const DOCUMENT = {
  fields: {
    level: { type: 'number' },
    hp_max: { type: 'number' },
    str: { type: 'number' },
    hit_die: { type: 'number' },
    skills: {
      type: 'multiselect',
      options: ['Arcana', 'History', { value: 'insight', label: 'Insight' }],
    },
    advancements: {
      type: 'list',
      columns: [
        { key: 'level', type: 'number' },
        { key: 'hp', type: 'number' },
      ],
    },
    feats: { type: 'content_list', content_type: 'feat', per_entry_fields: { from_level: {} } },
    origin: { type: 'content_ref', content_type: 'feat' },
  },
  prompts: { level_up: LEVEL_UP },
}

const SHEET = { level: 3, hp_max: 20, str: 15, hit_die: 8 }

describe('findPrompt', () => {
  it('finds a prompt by name', () => {
    expect(findPrompt(DOCUMENT, 'level_up')).toBe(LEVEL_UP)
  })

  it('finds nothing for an unknown name or a prototype key', () => {
    expect(findPrompt(DOCUMENT, 'nope')).toBeUndefined()
    expect(findPrompt(DOCUMENT, 'toString')).toBeUndefined()
    expect(findPrompt({}, 'level_up')).toBeUndefined()
  })
})

describe('visibleSteps', () => {
  it('shows a step only when its condition holds', () => {
    expect(visibleSteps(LEVEL_UP, { ...SHEET, level: 1 }, {}).map((s) => s.key)).toEqual(['hp'])
    expect(visibleSteps(LEVEL_UP, SHEET, {}).map((s) => s.key)).toEqual(['hp', 'kind'])
  })

  it('follows a select into its branch', () => {
    expect(visibleSteps(LEVEL_UP, SHEET, { kind: 'feat' }).map((s) => s.key)).toEqual([
      'hp',
      'kind',
      'feat',
    ])
  })

  it('drops the answers of a branch no longer taken', () => {
    const answers = { hp: 5, kind: 'feat', asi: { str: 2 } }
    expect(visibleAnswers(LEVEL_UP, SHEET, answers)).toEqual({ hp: 5, kind: 'feat' })
  })

  it('reads the picked entry as row', () => {
    const prompt: SheetPrompt = {
      label: 'Lineage',
      steps: [{ key: 'pick', type: 'select', options: ['a'], visible_if: 'row.has_lineage' }],
      apply: [{ prompt: 'x' }],
    }
    expect(visibleSteps(prompt, {}, {}, { has_lineage: true })).toHaveLength(1)
    expect(visibleSteps(prompt, {}, {}, null)).toHaveLength(0)
  })
})

describe('stepOptions', () => {
  it('reads a list written out, with labels', () => {
    expect(stepOptions(LEVEL_UP.steps[1], {}, DOCUMENT)).toEqual([
      { value: 'asi', label: 'Ability Score Improvement' },
      { value: 'feat', label: 'Feat' },
    ])
  })

  it('works a formula out, keeping only what the target offers, with its labels', () => {
    const step: PromptStep = { key: 's', type: 'choose', target: 'skills', options: 'row.skills' }
    expect(
      stepOptions(step, { row: { skills: ['insight', 'Stealth', 'Arcana'] } }, DOCUMENT)
    ).toEqual([
      { value: 'insight', label: 'Insight' },
      { value: 'Arcana', label: 'Arcana' },
    ])
  })

  it("falls back to the target's own options", () => {
    const step: PromptStep = { key: 's', type: 'choose', target: 'skills' }
    expect(stepOptions(step, {}, DOCUMENT).map((o) => o.value)).toEqual([
      'Arcana',
      'History',
      'insight',
    ])
  })
})

describe('distribute patterns', () => {
  const patterns = stepPatterns(LEVEL_UP.steps[2])

  it('reads patterns largest first', () => {
    expect(stepPatterns({ key: 'x', type: 'distribute', patterns: ['1,2', '1,1,1'] })).toEqual([
      [2, 1],
      [1, 1, 1],
    ])
  })

  it('accepts +2 to one or +1 to two, and nothing else', () => {
    expect(matchesPattern({ str: 2 }, patterns)).toBe(true)
    expect(matchesPattern({ str: 1, dex: 1 }, patterns)).toBe(true)
    expect(matchesPattern({ str: 1 }, patterns)).toBe(false)
    expect(matchesPattern({ str: 2, dex: 1 }, patterns)).toBe(false)
    expect(matchesPattern({ str: 1, dex: 1, con: 0 }, patterns)).toBe(true)
    expect(matchesPattern(undefined, patterns)).toBe(false)
  })
})

describe('numbers', () => {
  const step = LEVEL_UP.steps[0]

  it('works out the default and the average', () => {
    expect(numberDefault(step, SHEET)).toBe(0)
    expect(numberAverage(step, SHEET)).toBe(5)
  })

  it('keeps them within the bounds', () => {
    expect(numberAverage({ ...step, average: '-3' }, SHEET)).toBe(0)
  })
})

describe('isComplete', () => {
  it('needs every step showing answered', () => {
    expect(isComplete(LEVEL_UP, { ...SHEET, level: 1 }, { hp: 6 }, DOCUMENT, {})).toBe(true)
    expect(isComplete(LEVEL_UP, SHEET, { hp: 6 }, DOCUMENT, {})).toBe(false)
    expect(isComplete(LEVEL_UP, SHEET, { hp: 6, kind: 'asi' }, DOCUMENT, {})).toBe(false)
    expect(isComplete(LEVEL_UP, SHEET, { hp: 6, kind: 'asi', asi: { str: 2 } }, DOCUMENT, {})).toBe(
      true
    )
    expect(
      isComplete(LEVEL_UP, SHEET, { hp: 6, kind: 'feat', feat: { _ref: 'alert' } }, DOCUMENT, {})
    ).toBe(true)
  })

  it('asks a choose for no more than is left to take', () => {
    const prompt: SheetPrompt = {
      label: 'Skills',
      steps: [{ key: 's', type: 'choose', target: 'skills', count: 2 }],
      apply: [{ add: 'skills', values: 'answer.s' }],
    }
    const data = { skills: ['Arcana', 'History'] }
    expect(isComplete(prompt, {}, { s: ['insight'] }, DOCUMENT, data)).toBe(true)
    expect(isComplete(prompt, {}, { s: ['insight'] }, DOCUMENT, {})).toBe(false)
  })
})

describe('loadEntryOptions', () => {
  it('reads every page and keeps what the filter lets through', async () => {
    const pages: Record<number, { entry_id: string; name: string; data: { level: number } }[]> = {
      1: Array.from({ length: 200 }, (_, i) => ({
        entry_id: `f${i}`,
        name: `F${i}`,
        data: { level: i % 2 ? 1 : 8 },
      })),
      2: [{ entry_id: 'alert', name: 'Alert', data: { level: 1 } }],
    }
    const asked: number[] = []
    const found = await loadEntryOptions(LEVEL_UP.steps[3], SHEET, async (page) => {
      asked.push(page)
      return { entries: pages[page] || [], total: 201 }
    })
    expect(asked).toEqual([1, 2])
    expect(found).toHaveLength(101)
    expect(found.at(-1)).toMatchObject({ _ref: 'alert', name: 'Alert', level: 1 })
  })
})

describe('planPrompt', () => {
  const data = { ...SHEET, advancements: [{ level: 3, hp: 7 }], feats: [{ _ref: 'tough' }] }

  it('writes the answers as an action would, then picks and opens what follows', () => {
    const plan = planPrompt(LEVEL_UP, {
      document: DOCUMENT,
      data,
      context: SHEET,
      answers: {
        hp: 6,
        kind: 'feat',
        feat: { _ref: 'alert', _source: 'xphb', name: 'Alert' },
        asi: { str: 2 },
      },
    })
    expect(plan.patch).toEqual({
      level: 4,
      hp_max: 26,
      // The ASI branch was not taken: its answer reads as nothing.
      str: 15,
      advancements: [
        { level: 3, hp: 7 },
        { level: 4, hp: 6 },
      ],
    })
    expect(plan.picks).toEqual([
      {
        field: 'feats',
        value: [{ _ref: 'tough' }, { _ref: 'alert', _source: 'xphb', _per: { from_level: 4 } }],
        entry: { _ref: 'alert', _source: 'xphb', name: 'Alert' },
      },
    ])
    expect(plan.prompts).toEqual(['spells'])
  })

  it('skips a pick with no entry answered', () => {
    const plan = planPrompt(LEVEL_UP, {
      document: DOCUMENT,
      data,
      context: SHEET,
      answers: { hp: 6, kind: 'asi', asi: { str: 2 } },
    })
    expect(plan.patch.str).toBe(17)
    expect(plan.picks).toEqual([])
  })

  it('picks into a content_ref as its value', () => {
    const prompt: SheetPrompt = {
      label: 'Origin feat',
      steps: [{ key: 'f', type: 'entry', content_type: 'feat' }],
      apply: [{ pick: 'origin', entry: 'answer.f' }],
    }
    const plan = planPrompt(prompt, {
      document: DOCUMENT,
      data: {},
      context: {},
      answers: { f: { _ref: 'alert', name: 'Alert' } },
    })
    expect(plan.picks).toEqual([
      { field: 'origin', value: { _ref: 'alert' }, entry: { _ref: 'alert', name: 'Alert' } },
    ])
  })

  it('adds chosen values to a multiselect, recorded under the pick that opened it', () => {
    const prompt: SheetPrompt = {
      label: 'Skills',
      steps: [{ key: 's', type: 'choose', target: 'skills', count: 2 }],
      apply: [
        { add: 'skills', values: 'answer.s' },
        { pick: 'feats', entry: 'answer.f' },
      ],
    }
    const plan = planPrompt(prompt, {
      document: DOCUMENT,
      data: { skills: ['Arcana'], _granted: { klass: { skills: ['History'] } } },
      context: {},
      answers: { s: ['Arcana', 'insight', 'Stealth'] },
      source: 'klass',
    })
    expect(plan.patch.skills).toEqual(['Arcana', 'insight'])
    expect(plan.patch._granted).toEqual({ klass: { skills: ['History', 'insight'] } })
  })

  it('records nothing without a source', () => {
    const prompt: SheetPrompt = {
      label: 'Skills',
      steps: [{ key: 's', type: 'choose', target: 'skills' }],
      apply: [{ add: 'skills', values: 'answer.s' }],
    }
    const plan = planPrompt(prompt, {
      document: DOCUMENT,
      data: {},
      context: {},
      answers: { s: ['History'] },
    })
    expect(plan.patch).toEqual({ skills: ['History'] })
  })
})

describe('grant', () => {
  const document = {
    fields: {
      level: { type: 'number' },
      skills: { type: 'multiselect', options: ['Arcana', 'History'] },
      features: { type: 'content_list', content_type: 'feature' },
      klass: { type: 'content_ref', content_type: 'class', on_pick: [] },
    },
  }
  const fighter = {
    name: 'Fighter',
    feature_ids_2: ['action-surge', 'tactical-mind'],
    feature_names_2: 'Action Surge, Tactical Mind',
  }
  const prompt: SheetPrompt = {
    label: 'Level up',
    steps: [{ key: 'hp', type: 'number' }],
    apply: [
      {
        grant: 'features',
        from: "ref(klass, concat('feature_ids_', level + 1))",
        names: "ref(klass, concat('feature_names_', level + 1))",
        carry: { class: "ref(klass, 'name')" },
        source: 'klass',
      },
      { grant: 'skills', from: "'History, Stealth'" },
      { grant: 'features', from: 'row.feature_ids_9' },
    ],
  }

  it('works out its formulas into grants, recorded under their source or the prompt one', () => {
    const plan = planPrompt(prompt, {
      document,
      data: {},
      context: { level: 1, klass: { _ref: 'fighter' }, _entries: { fighter } },
      answers: { hp: 5 },
      row: fighter,
      source: 'background',
    })
    expect(plan.patch).toEqual({})
    expect(plan.grants).toEqual([
      {
        target: 'features',
        pairs: [
          ['action-surge', 'Action Surge'],
          ['tactical-mind', 'Tactical Mind'],
        ],
        carried: { class: 'Fighter' },
        source: 'klass',
      },
      {
        target: 'skills',
        pairs: [
          ['History', ''],
          ['Stealth', ''],
        ],
        carried: {},
        source: 'background',
      },
    ])
  })

  it('grants a reference the catalog has as the list type, a named entry otherwise', async () => {
    const asked: string[][] = []
    const patch = await planGrants(
      [
        {
          target: 'features',
          pairs: [
            ['action-surge', 'Action Surge'],
            ['tactical-mind', 'Tactical Mind'],
            ['second-wind', 'Second Wind'],
          ],
          carried: { class: 'Fighter' },
          source: 'klass',
        },
        {
          target: 'skills',
          pairs: [
            ['History', ''],
            ['Stealth', ''],
          ],
          carried: {},
        },
      ],
      {
        document,
        data: {
          features: [{ _ref: 'second-wind' }],
          skills: ['Arcana'],
          _granted: { klass: { features: ['second-wind'] } },
        },
        lookup: async (ids) => {
          asked.push(ids)
          return {
            'action-surge': { content_type: 'feature', source: 'xphb' },
            'tactical-mind': { content_type: 'spell' },
            'second-wind': { content_type: 'feature' },
          }
        },
      }
    )
    expect(asked).toEqual([['action-surge', 'tactical-mind', 'second-wind']])
    expect(patch).toEqual({
      features: [
        { _ref: 'second-wind' },
        { _ref: 'action-surge', _source: 'xphb' },
        { _inline: true, class: 'Fighter', name: 'Tactical Mind' },
      ],
      // Stealth is not one of the multiselect's options.
      skills: ['Arcana', 'History'],
      _granted: { klass: { features: ['second-wind', 'action-surge', 'Tactical Mind'] } },
    })
  })

  it('falls back to named entries when the catalog cannot be asked', async () => {
    const patch = await planGrants(
      [{ target: 'features', pairs: [['action-surge', 'Action Surge']], carried: {} }],
      {
        document,
        data: {},
        lookup: async () => {
          throw new Error('offline')
        },
      }
    )
    expect(patch).toEqual({ features: [{ _inline: true, name: 'Action Surge' }] })
  })
})

describe('pending prompts', () => {
  const request = { prompt: 'lineage', source: 'species', ref: 'elf', row: { name: 'Elf' } }

  it('keeps a prompt put off once, without its row', () => {
    const patch = withPending({}, request)
    expect(patch).toEqual({
      _pending_prompts: [{ prompt: 'lineage', source: 'species', ref: 'elf' }],
    })
    expect(withPending(patch, request)).toEqual({})
    expect(pendingPrompts(patch)).toHaveLength(1)
  })

  it('forgets it once answered, and every prompt of a field picked again', () => {
    const data = {
      _pending_prompts: [
        { prompt: 'lineage', source: 'species', ref: 'elf' },
        { prompt: 'level_up' },
      ],
    }
    expect(withoutPending(data, request)).toEqual({ _pending_prompts: [{ prompt: 'level_up' }] })
    expect(withoutPending(data, { prompt: 'nope' })).toEqual({})
    expect(withoutPendingFrom(data, 'species')).toEqual({
      _pending_prompts: [{ prompt: 'level_up' }],
    })
    expect(withoutPendingFrom(data, 'background')).toEqual({})
  })
})
