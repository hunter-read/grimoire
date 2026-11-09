import { describe, it, expect } from 'vitest'
import {
  buildContext,
  computeValues,
  derivedColumns,
  emptyCellFor,
  isEmptyCell,
} from './expressions'

// Mirrors backend/tests/test_character_list_default_from.py: a family record
// whose `age` column follows `campaign_year - born`.
const age = (overrides: Record<string, unknown> = {}) => ({
  key: 'age',
  type: 'number',
  min: 0,
  default_from: 'born ? campaign_year - born : null',
  ...overrides,
})

const documentWith = (column = age(), fields: Record<string, unknown> = {}) => ({
  fields: {
    campaign_year: { type: 'number', default: 1890 },
    family_records: {
      type: 'list',
      columns: [{ key: 'name', type: 'text' }, { key: 'born', type: 'number' }, column],
    },
    ...fields,
  },
  computed: { total_age: { formula: "sum_where(family_records, 'age')" } },
})

const rowsOf = (document: ReturnType<typeof documentWith>, data: Record<string, unknown>) =>
  buildContext(document, data).family_records as Record<string, unknown>[]

describe('buildContext with derived list columns', () => {
  it('works out an empty cell', () => {
    expect(rowsOf(documentWith(), { family_records: [{ born: 1850, age: null }] })[0].age).toBe(40)
  })

  it("treats '' as unset", () => {
    expect(rowsOf(documentWith(), { family_records: [{ born: 1850, age: '' }] })[0].age).toBe(40)
  })

  it('keeps a typed value, 0 included', () => {
    const rows = rowsOf(documentWith(), {
      family_records: [
        { born: 1850, age: 12 },
        { born: 1850, age: 0 },
      ],
    })
    expect(rows.map((row) => row.age)).toEqual([12, 0])
  })

  it('follows the campaign year', () => {
    const rows = rowsOf(documentWith(), {
      campaign_year: 1900,
      family_records: [{ born: 1850, age: null }],
    })
    expect(rows[0].age).toBe(50)
  })

  it('reads a top-level derived field', () => {
    const document = documentWith(age({ default_from: 'born ? year_now - born : null' }), {
      year_now: { type: 'number', default_from: 'campaign_year + 10' },
    })
    expect(rowsOf(document, { family_records: [{ born: 1850, age: null }] })[0].age).toBe(50)
  })

  it('lets a column shadow a field of the same name', () => {
    const document = documentWith(age(), { born: { type: 'number', default: 1000 } })
    expect(rowsOf(document, { family_records: [{ born: 1850, age: null }] })[0].age).toBe(40)
  })

  it('clamps the result to the column bounds', () => {
    expect(rowsOf(documentWith(), { family_records: [{ born: 1900, age: null }] })[0].age).toBe(0)
  })

  it("falls back to the column's default, then to empty", () => {
    expect(rowsOf(documentWith(age({ default: 18 })), { family_records: [{}] })[0].age).toBe(18)
    expect(rowsOf(documentWith(), { family_records: [{}] })[0].age).toBeNull()
  })

  it('leaves the stored rows alone', () => {
    const data = { family_records: [{ born: 1850, age: null }] }
    buildContext(documentWith(), data)
    expect(data.family_records[0].age).toBeNull()
  })

  it('passes a row that is not an object through', () => {
    expect(rowsOf(documentWith(), { family_records: ['junk'] })).toEqual(['junk'])
  })

  it('lets an aggregate see the derived values', () => {
    const computed = computeValues(documentWith(), {
      family_records: [
        { born: 1850, age: null },
        { born: 1880, age: 5 },
      ],
    })
    expect(computed.total_age).toBe(45)
  })

  it('types a text cell and checks a select against its options', () => {
    const document = {
      fields: {
        rank: { type: 'text', default: 'Captain' },
        crew: {
          type: 'list',
          columns: [
            { key: 'title', type: 'text', default_from: 'concat(rank, 1)' },
            { key: 'grade', type: 'select', options: ['A', { value: 'B' }], default_from: "'B'" },
            { key: 'other', type: 'select', options: ['A'], default_from: "'Z'" },
            { key: 'n', type: 'number', default_from: "'x'" },
          ],
        },
      },
    }
    const rows = buildContext(document, { crew: [{}] }).crew as Record<string, unknown>[]
    expect(rows[0]).toEqual({ title: 'Captain1', grade: 'B', other: '', n: null })
  })
})

describe('derived column helpers', () => {
  it('finds only the columns with a formula, on a list', () => {
    expect(derivedColumns(documentWith().fields.family_records).map((c) => c.key)).toEqual(['age'])
    expect(derivedColumns({ type: 'text' })).toEqual([])
    expect(derivedColumns(null)).toEqual([])
  })

  it('knows an empty cell from a zero', () => {
    expect([null, undefined, '', 0, false].map(isEmptyCell)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
  })

  it('stores an empty cell by type', () => {
    expect([emptyCellFor('checkbox'), emptyCellFor('number'), emptyCellFor('text')]).toEqual([
      false,
      null,
      '',
    ])
  })
})
