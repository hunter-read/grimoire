import { describe, it, expect } from 'vitest'
import {
  findPrompt,
  isAnswered,
  isComplete,
  matchesPattern,
  numberAverage,
  numberDefault,
  pendingPrompts,
  listPick,
  planGrants,
  planPrompt,
  startPrompt,
  stepLabel,
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

describe('entries answers', () => {
  const step: PromptStep = { key: 'spells', type: 'entries', content_type: 'spell', count: 'n' }
  const spell = (id: string) => ({ _ref: id, name: id })

  it('needs exactly its count, or as many as the catalog offers when fewer', () => {
    const two = [spell('a'), spell('b')]
    expect(isAnswered(step, two, { n: 2 }, DOCUMENT, {})).toBe(true)
    expect(isAnswered(step, two, { n: 3 }, DOCUMENT, {})).toBe(false)
    expect(isAnswered(step, two, { n: 3 }, DOCUMENT, {}, 2)).toBe(true)
    expect(isAnswered(step, [spell('a'), { name: 'loose' }], { n: 2 }, DOCUMENT, {})).toBe(false)
  })

  it('needs no answer when its count works out to nothing', () => {
    expect(isAnswered(step, undefined, { n: 0 }, DOCUMENT, {})).toBe(true)
    expect(isAnswered(step, undefined, { n: 1 }, DOCUMENT, {}, 0)).toBe(true)
    expect(isAnswered(step, undefined, { n: 1 }, DOCUMENT, {})).toBe(false)
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
        add: { _ref: 'alert', _source: 'xphb', _per: { from_level: 4 } },
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

  it('takes a row out of a list and adds one, each made when its turn comes', () => {
    const prompt: SheetPrompt = {
      label: 'Replace a feat',
      steps: [
        { key: 'old', type: 'entry', content_type: 'feat' },
        { key: 'new', type: 'entry', content_type: 'feat' },
      ],
      apply: [
        { unpick: 'feats', entry: 'answer.old' },
        { pick: 'feats', entry: 'answer.new' },
      ],
    }
    const data = { feats: [{ _ref: 'tough' }, { _ref: 'alert', _per: { from_level: 4 } }] }
    const plan = planPrompt(prompt, {
      document: DOCUMENT,
      data,
      context: {},
      answers: { old: { _ref: 'Tough', name: 'Tough' }, new: { _ref: 'lucky', name: 'Lucky' } },
    })
    expect(plan.picks).toEqual([
      { field: 'feats', remove: { _ref: 'Tough', name: 'Tough' } },
      { field: 'feats', add: { _ref: 'lucky' }, entry: { _ref: 'lucky', name: 'Lucky' } },
    ])
    // Made one after another, the pick sees the list without the row.
    let sheet: Record<string, unknown> = data
    for (const pick of plan.picks) {
      if ('value' in pick) continue
      sheet = { ...sheet, ...listPick(sheet, pick) }
    }
    expect(sheet.feats).toEqual([{ _ref: 'alert', _per: { from_level: 4 } }, { _ref: 'lucky' }])
  })

  it('asks to take out nothing when no entry was answered', () => {
    const prompt: SheetPrompt = {
      label: 'Replace a feat',
      steps: [{ key: 'old', type: 'entry', content_type: 'feat' }],
      apply: [{ unpick: 'feats', entry: 'answer.old' }],
    }
    const plan = (answers: Record<string, unknown>) =>
      planPrompt(prompt, {
        document: DOCUMENT,
        data: { feats: [{ _ref: 'tough' }] },
        context: {},
        answers,
      })
    expect(plan({}).picks).toEqual([])
    expect(plan({ old: { name: '  ' } }).picks).toEqual([])
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

describe('planPrompt with an entries answer', () => {
  const SPELLS = [
    { _ref: 'bolt', _source: 'phb', name: 'Bolt', level: 1 },
    { _ref: 'ward', name: 'Ward', level: 2 },
  ]
  const prompt = (apply: SheetPrompt['apply']): SheetPrompt => ({
    label: 'Spells',
    steps: [{ key: 'spells', type: 'entries', content_type: 'feat', count: 2 }],
    apply,
  })

  it('picks each entry into a content_list, each value reading the entry picked', () => {
    const plan = planPrompt(
      prompt([
        {
          pick: 'feats',
          entry: 'answer.spells',
          values: { from_level: 'level + entry.level' },
        },
      ]),
      {
        document: DOCUMENT,
        data: SHEET,
        context: SHEET,
        answers: { spells: SPELLS },
        source: 'origin',
      }
    )
    expect(plan.picks).toEqual([
      {
        field: 'feats',
        add: { _ref: 'bolt', _source: 'phb', _per: { from_level: 4 } },
        entry: SPELLS[0],
      },
      { field: 'feats', add: { _ref: 'ward', _per: { from_level: 5 } }, entry: SPELLS[1] },
    ])
    expect(plan.patch._granted).toEqual({ origin: { feats: ['bolt', 'ward'] } })
  })

  it('picks the first entry of a list into a content_ref', () => {
    const plan = planPrompt(prompt([{ pick: 'origin', entry: 'answer.spells' }]), {
      document: DOCUMENT,
      data: SHEET,
      context: SHEET,
      answers: { spells: SPELLS },
    })
    expect(plan.picks).toEqual([
      { field: 'origin', value: { _ref: 'bolt', _source: 'phb' }, entry: SPELLS[0] },
    ])
  })

  it('takes each entry of a list out of a content_list', () => {
    const plan = planPrompt(prompt([{ unpick: 'feats', entry: 'answer.spells' }]), {
      document: DOCUMENT,
      data: SHEET,
      context: SHEET,
      answers: { spells: [...SPELLS, 'not an entry'] },
    })
    expect(plan.picks).toEqual([
      { field: 'feats', remove: SPELLS[0] },
      { field: 'feats', remove: SPELLS[1] },
    ])
  })

  it("reads a single entry step's answer as entry too", () => {
    const plan = planPrompt(
      {
        label: 'Feat',
        steps: [{ key: 'feat', type: 'entry', content_type: 'feat' }],
        apply: [{ pick: 'feats', entry: 'answer.feat', values: { from_level: 'entry.level' } }],
      },
      { document: DOCUMENT, data: SHEET, context: SHEET, answers: { feat: SPELLS[1] } }
    )
    expect(plan.picks).toEqual([
      { field: 'feats', add: { _ref: 'ward', _per: { from_level: 2 } }, entry: SPELLS[1] },
    ])
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

  it("grants an entry step's answer on its own, and pairs names by position", () => {
    const plan = planPrompt(
      {
        label: 'Gifts',
        steps: [{ key: 'gift', type: 'entry', content_type: 'feature' }],
        apply: [
          { grant: 'features', from: 'answer.gift' },
          // The empty slot in the names keeps 'C' on 'c'.
          { grant: 'features', from: 'row.ids', names: "'A,,C'" },
        ],
      },
      {
        document,
        data: {},
        context: {},
        answers: { gift: { _ref: 'alert', name: 'Alert' } },
        row: { ids: ['a', 'b', 'c'] },
      }
    )
    expect(plan.grants.map((grant) => grant.pairs)).toEqual([
      [['alert', '']],
      [
        ['a', 'A'],
        ['b', ''],
        ['c', 'C'],
      ],
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

  it('reads the sheet once the catalog has answered, when given a way to read it', async () => {
    let data: Record<string, unknown> = { features: [] }
    const patch = await planGrants(
      [{ target: 'features', pairs: [['action-surge', 'Action Surge']], carried: {} }],
      {
        document,
        data: () => data,
        lookup: async () => {
          data = { features: [{ _inline: true, name: 'Hand' }] }
          return {}
        },
      }
    )
    expect(patch).toEqual({
      features: [
        { _inline: true, name: 'Hand' },
        { _inline: true, name: 'Action Surge' },
      ],
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

describe('stepLabel', () => {
  it('shows the label formula worked out, else the label', () => {
    const step: PromptStep = {
      key: 'swap',
      type: 'select',
      label: 'Replace an option?',
      label_formula: "kind != '' ? concat('Replace one ', kind, '?') : ''",
    }
    expect(stepLabel(step, { kind: 'Metamagic' })).toBe('Replace one Metamagic?')
    expect(stepLabel(step, { kind: '' })).toBe('Replace an option?')
    expect(stepLabel({ ...step, label_formula: 'missing(' }, {})).toBe('Replace an option?')
  })

  it('falls back to the label for anything but text that is not blank', () => {
    const step: PromptStep = { key: 'swap', type: 'select', label: 'Replace an option?' }
    for (const formula of ['false', '0', 'level', "'  '"]) {
      expect(stepLabel({ ...step, label_formula: formula }, { level: 0 })).toBe(
        'Replace an option?'
      )
    }
  })
})

describe('startPrompt', () => {
  const document = {
    prompts: { level_up: { label: 'Level up', steps: [{ key: 'x', type: 'number' }], apply: [] } },
    start_prompt: { prompt: 'level_up', when: 'level == 0' },
  }

  it('names the prompt while its condition holds', () => {
    expect(startPrompt(document, { level: 0 })).toBe('level_up')
    expect(startPrompt(document, { level: 1 })).toBeUndefined()
    expect(startPrompt({ ...document, start_prompt: { prompt: 'level_up' } }, {})).toBe('level_up')
  })

  it('names nothing for a prompt the sheet lacks', () => {
    expect(
      startPrompt({ ...document, start_prompt: { prompt: 'gone' } }, { level: 0 })
    ).toBeUndefined()
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

describe('listPick', () => {
  it('takes out nothing when the entry has no row', () => {
    expect(
      listPick({ feats: [{ _ref: 'tough' }] }, { field: 'feats', remove: { _ref: 'lucky' } })
    ).toEqual({})
    expect(listPick({}, { field: 'feats', remove: { _ref: 'lucky' } })).toEqual({})
  })

  it("takes out the copy from the answer's source when the list holds the id twice", () => {
    const data = {
      feats: [
        { _ref: 'alert', _source: 'phb' },
        { _ref: 'alert', _source: 'xphb' },
      ],
    }
    expect(
      listPick(data, { field: 'feats', remove: { _ref: 'alert', _source: 'xphb' } }).feats
    ).toEqual([{ _ref: 'alert', _source: 'phb' }])
    // An answer from neither source takes the first.
    expect(
      listPick(data, { field: 'feats', remove: { _ref: 'alert', _source: 'tce' } }).feats
    ).toEqual([{ _ref: 'alert', _source: 'xphb' }])
  })

  it('finds a freeform row by its name, in any case, and a reference only by its id', () => {
    const data = { feats: [{ _inline: true, name: 'Lucky' }, { _ref: 'tough' }] }
    expect(listPick(data, { field: 'feats', remove: { _ref: 'x', name: 'lucky' } }).feats).toEqual([
      { _ref: 'tough' },
    ])
    // A name is not a reference's id.
    expect(listPick(data, { field: 'feats', remove: { name: 'Tough' } })).toEqual({})
  })

  it('drops the row from its records, unless a row still on the list answers to it', () => {
    const granted = { _granted: { origin_feat: { feats: ['Tough'] }, klass: { skills: ['x'] } } }
    // The hand-added reference goes; the granted freeform row stays, and so
    // does the record standing for it.
    const both = {
      feats: [{ _ref: 'tough' }, { _inline: true, name: 'Tough' }],
      ...granted,
    }
    expect(listPick(both, { field: 'feats', remove: { _ref: 'tough', name: 'Tough' } })).toEqual({
      feats: [{ _inline: true, name: 'Tough' }],
    })
    // The only row goes, and its record with it, in any case.
    const one = { feats: [{ _inline: true, name: 'Tough' }], ...granted }
    expect(listPick(one, { field: 'feats', remove: { name: 'TOUGH' } })).toEqual({
      feats: [],
      _granted: { origin_feat: { feats: [] }, klass: { skills: ['x'] } },
    })
  })
})
