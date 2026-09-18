import { describe, it, expect } from 'vitest'
import { evaluate, parse, computeValues, ExpressionError } from './expressions'

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
