import { describe, it, expect } from 'vitest'
import {
  evaluate,
  parse,
  computeValues,
  runValidators,
  visibleFields,
  isVisible,
  ExpressionError,
} from './expressions'

// These mirror backend/tests/test_character_engine.py::TestExpressions. The two
// evaluators must agree, so the cases are deliberately the same ones.

describe('expressions', () => {
  describe('arithmetic and functions', () => {
    it.each([
      ['1 + 2', 3],
      ['10 - 4 * 2', 2],
      ['(10 - 4) * 2', 12],
      ['7 / 2', 3.5],
      ['8 / 2', 4],
      ['7 % 3', 1],
      ['-5 + 2', -3],
      ['floor(3.7)', 3],
      ['ceil(3.2)', 4],
      ['abs(-4)', 4],
      ['min(3, 1, 2)', 1],
      ['max(3, 1, 2)', 3],
      ['clamp(15, 1, 10)', 10],
      ['sum(1, 2, 3)', 6],
      ['signed(3)', '+3'],
      ['signed(-2)', '-2'],
      ['signed(0)', '+0'],
    ])('%s evaluates to %s', (formula, expected) => {
      expect(evaluate(formula, {})).toBe(expected)
    })
  })

  describe('logic', () => {
    it.each([
      ['2 > 1', true],
      ['1 >= 1', true],
      ['2 == 2', true],
      ['2 != 3', true],
      ['1 > 2 or 2 > 1', true],
      ['1 > 2 and 2 > 1', false],
      ['not (1 > 2)', true],
      ["2 > 1 ? 'yes' : 'no'", 'yes'],
      ["1 > 2 ? 'yes' : 'no'", 'no'],
      ['if(2 > 1, 10, 20)', 10],
    ])('%s evaluates to %s', (formula, expected) => {
      expect(evaluate(formula, {})).toBe(expected)
    })
  })

  it('reads values from the context', () => {
    expect(evaluate('floor((strength - 10) / 2)', { strength: 16 })).toBe(3)
    expect(evaluate('floor((strength - 10) / 2)', { strength: 8 })).toBe(-1)
  })

  it('reads dotted paths out of nested objects', () => {
    expect(evaluate('a.b.c', { a: { b: { c: 42 } } })).toBe(42)
  })

  it('compares strings case-insensitively', () => {
    expect(evaluate("race == 'Elf'", { race: 'elf' })).toBe(true)
  })

  describe('half-filled sheets still render', () => {
    it.each([
      ['missing + 1', {}],
      ['strength / 0', { strength: 10 }],
      ['strength % 0', { strength: 10 }],
      ['level + 1', { level: '' }],
      ['level + 1', { level: 'not a number' }],
    ])('%s does not throw', (formula, context) => {
      expect(() => evaluate(formula, context)).not.toThrow()
    })

    it('treats division by zero as zero', () => {
      expect(evaluate('10 / 0', {})).toBe(0)
    })

    it('returns the fallback for an unparseable formula', () => {
      expect(evaluate('1 +', {}, -1)).toBe(-1)
    })
  })

  describe('the sandbox', () => {
    it.each(["__import__('os')", 'eval("1+1")', 'globals()', 'alert(1)'])(
      'rejects %s',
      (formula) => {
        expect(() => parse(formula)).toThrow(ExpressionError)
      }
    )

    it('cannot reach JavaScript internals through a dotted path', () => {
      // A name like `window.location` or `x.constructor` is a *path*, so it
      // parses like any other. What makes it harmless is evaluation: a path
      // only reads own properties of plain objects, so it resolves to 0 rather
      // than reaching a global or a prototype.
      expect(evaluate('strength.constructor', { strength: 16 })).toBe(0)
      expect(evaluate('a.__proto__', { a: {} })).toBe(0)
      expect(evaluate('a.toString', { a: {} })).toBe(0)
      expect(evaluate('window.location', {})).toBe(0)
      expect(evaluate('this.constructor', {})).toBe(0)
    })
  })
})

describe('computeValues', () => {
  const document = {
    fields: { strength: { type: 'number', default: 10 } },
    computed: { str_mod: { formula: 'floor((strength - 10) / 2)' } },
  }

  it('computes from data', () => {
    expect(computeValues(document, { strength: 16 })).toEqual({ str_mod: 3 })
  })

  it('falls back to declared defaults', () => {
    expect(computeValues(document, {})).toEqual({ str_mod: 0 })
  })

  it('resolves chained dependencies regardless of declaration order', () => {
    const chained = {
      fields: { strength: { type: 'number', default: 0 } },
      computed: {
        total: { formula: 'doubled + 1' },
        doubled: { formula: 'strength * 2' },
      },
    }
    expect(computeValues(chained, { strength: 5 })).toEqual({ doubled: 10, total: 11 })
  })

  it('terminates on a cyclic schema', () => {
    const cyclic = {
      fields: {},
      computed: { a: { formula: 'b + 1' }, b: { formula: 'a + 1' } },
    }
    expect(() => computeValues(cyclic, {})).not.toThrow()
  })

  it('returns an empty object when there is nothing computed', () => {
    expect(computeValues({ fields: {} }, {})).toEqual({})
  })
})

// --- Phase 2: list functions, validators, visibility ------------------------
// These mirror backend/tests/test_character_engine.py's Phase 2 classes. The
// two evaluators must agree, so the cases are deliberately the same.

describe('list functions', () => {
  const rows = [
    { name: 'Sword', qty: 1, equipped: true },
    { name: 'Rope', qty: 2, equipped: false },
    { name: 'Torch', qty: 5, equipped: true },
  ]
  const context = { kit: rows, langs: ['common', 'elvish'] }

  it.each([
    ["count_where(kit, 'equipped')", 2],
    ["count_where(kit, 'equipped', false)", 1],
    ["sum_where(kit, 'qty')", 8],
    ["sum_where(kit, 'qty', 'equipped', true)", 6],
    ["any_where(kit, 'equipped')", true],
    ["sum(column(kit, 'qty'))", 8],
    ["max(column(kit, 'qty'))", 5],
    ["min(column(kit, 'qty'))", 1],
    ['len(kit)', 3],
  ])('%s evaluates to %s', (formula, expected) => {
    expect(evaluate(formula, context)).toBe(expected)
  })

  it('contains matches a multiselect case-insensitively', () => {
    expect(evaluate("contains(langs, 'Elvish')", context)).toBe(true)
    expect(evaluate("contains(langs, 'orcish')", context)).toBe(false)
  })

  it('tolerates a field that is not a list', () => {
    expect(evaluate("count_where(kit, 'equipped')", { kit: 'nonsense' })).toBe(0)
  })

  it('ignores rows that are not objects', () => {
    expect(evaluate("count_where(kit, 'a')", { kit: ['x', 5, null] })).toBe(0)
  })
})

describe('runValidators', () => {
  const document = {
    fields: {
      level: { type: 'number', default: 1 },
      equipment: { type: 'list', columns: [{ key: 'equipped', type: 'checkbox' }] },
    },
    computed: { carried: { formula: "count_where(equipment, 'equipped')" } },
    validators: [
      { rule: 'level >= 3', severity: 'error', message: 'Too low' },
      { rule: 'carried <= 2', severity: 'warning', message: 'Overloaded' },
    ],
  }

  it('reports only the rules that failed', () => {
    const fired = runValidators(document, { level: 5, equipment: [{ equipped: true }] })
    expect(fired).toEqual([])
  })

  it('reports a failing rule with its message and severity', () => {
    const fired = runValidators(document, { level: 1, equipment: [] })
    expect(fired).toHaveLength(1)
    expect(fired[0]).toMatchObject({ message: 'Too low', severity: 'error' })
  })

  it('evaluates rules against computed values too', () => {
    const fired = runValidators(document, {
      level: 5,
      equipment: [{ equipped: true }, { equipped: true }, { equipped: true }],
    })
    expect(fired).toHaveLength(1)
    expect(fired[0].message).toBe('Overloaded')
  })

  it('defaults an unrecognised severity to warning', () => {
    const doc = { fields: {}, validators: [{ rule: '1 == 2', severity: 'nonsense', message: 'x' }] }
    expect(runValidators(doc, {})[0].severity).toBe('warning')
  })

  it('stays quiet about a rule it cannot evaluate', () => {
    // Schema validation rejects these at install, so reaching here means a
    // stored document drifted — inventing a warning would be worse.
    const doc = { fields: {}, validators: [{ rule: '1 +', message: 'broken' }] }
    expect(runValidators(doc, {})).toEqual([])
  })

  it('returns nothing when the schema declares no validators', () => {
    expect(runValidators({ fields: {} }, {})).toEqual([])
  })
})

describe('visibleFields', () => {
  const document = {
    fields: {
      is_caster: { type: 'checkbox' },
      spell_dc: { type: 'number', visible_if: 'is_caster' },
      level: { type: 'number', default: 1 },
      capstone: { type: 'text', visible_if: 'level >= 20' },
    },
    computed: {},
  }

  it('reports only fields that declare a condition', () => {
    expect(Object.keys(visibleFields(document, {})).sort()).toEqual(['capstone', 'spell_dc'])
  })

  it('reflects the current values', () => {
    expect(visibleFields(document, { is_caster: true, level: 20 })).toEqual({
      spell_dc: true,
      capstone: true,
    })
    expect(visibleFields(document, { is_caster: false, level: 3 })).toEqual({
      spell_dc: false,
      capstone: false,
    })
  })

  it('shows a field whose condition is broken rather than hiding it', () => {
    // Losing access to your own data is the worse failure.
    const broken = { fields: { x: { type: 'text', visible_if: '1 +' } } }
    expect(visibleFields(broken, {})).toEqual({ x: true })
  })
})

describe('isVisible', () => {
  it('treats an absent condition as visible', () => {
    expect(isVisible(undefined, {})).toBe(true)
    expect(isVisible('', {})).toBe(true)
  })

  it('evaluates a condition against the context', () => {
    expect(isVisible('level > 4', { level: 5 })).toBe(true)
    expect(isVisible('level > 4', { level: 2 })).toBe(false)
  })
})

// --- Phase 3: catalog references -------------------------------------------
// Mirrors backend/tests/test_content_catalog.py and the engine's catalog tests.
// A reference is {_ref, _source, _per}; reading an entry's own properties needs
// the resolved table, which rides in the context as `_entries`.

describe('catalog functions', () => {
  const entries = {
    fireball: { name: 'Fireball', level: 3, school: 'evocation' },
    shield: { name: 'Shield', level: 1, school: 'abjuration' },
  }
  const context = {
    spells: [
      { _ref: 'fireball', _per: { prepared: true } },
      { _ref: 'shield' },
      { _inline: true, name: 'My Cantrip' },
    ],
    klass: { _ref: 'fireball' },
    _entries: entries,
  }

  it.each([
    ["ref(klass, 'name')", 'Fireball'],
    ["ref(klass, 'level')", 3],
    ["sum_refs(spells, 'level')", 4],
    ["has_ref(spells, 'fireball')", true],
    ["has_ref(spells, 'missing')", false],
    ['count_refs(spells)', 3],
    ["count_refs(spells, 'prepared')", 1],
    ["count_refs(spells, 'level', 3)", 1],
  ])('%s evaluates to %s', (formula, expected) => {
    expect(evaluate(formula, context)).toBe(expected)
  })

  it('layers the character’s per-entry notes over the catalog entry', () => {
    // `prepared` lives on the character, `level` on the entry; both resolve.
    expect(evaluate("count_refs(spells, 'prepared')", context)).toBe(1)
  })

  it('reads 0 before the catalog has resolved', () => {
    // A sheet renders before its entries arrive; it must not throw.
    expect(evaluate("ref(klass, 'name')", { klass: { _ref: 'fireball' } })).toBe(0)
    expect(evaluate("sum_refs(spells, 'level')", { spells: context.spells })).toBe(0)
  })

  it('counts an inline entry but cannot read catalog properties from it', () => {
    expect(evaluate('count_refs(spells)', context)).toBe(3)
    expect(evaluate("sum_refs(spells, 'level')", context)).toBe(4)
  })

  it('tolerates a reference field that is not a list', () => {
    expect(evaluate("sum_refs(klass, 'level')", context)).toBe(3)
    expect(evaluate('count_refs(nothing)', context)).toBe(0)
  })
})
