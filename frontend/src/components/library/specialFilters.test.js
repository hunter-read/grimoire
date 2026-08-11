import { describe, it, expect } from 'vitest'
import {
  FILTER_NONE,
  FILTER_ANY,
  isSpecialFilter,
  isEmptyField,
  matchSpecial,
  splitSpecial,
  withSpecialOptions,
} from './specialFilters'

describe('isSpecialFilter', () => {
  it('recognises the sentinels and nothing else', () => {
    expect(isSpecialFilter(FILTER_NONE)).toBe(true)
    expect(isSpecialFilter(FILTER_ANY)).toBe(true)
    expect(isSpecialFilter('Fantasy')).toBe(false)
    expect(isSpecialFilter(undefined)).toBe(false)
  })
})

describe('isEmptyField', () => {
  it('treats null, undefined, blank strings and empty arrays as empty', () => {
    expect(isEmptyField(null)).toBe(true)
    expect(isEmptyField(undefined)).toBe(true)
    expect(isEmptyField('')).toBe(true)
    expect(isEmptyField('   ')).toBe(true)
    expect(isEmptyField([])).toBe(true)
  })

  it('treats any present value as non-empty', () => {
    expect(isEmptyField('Fantasy')).toBe(false)
    expect(isEmptyField(['Fantasy'])).toBe(false)
    expect(isEmptyField(0)).toBe(false)
  })
})

describe('matchSpecial', () => {
  const matchValue = (field, wanted) => field === wanted

  it('matches empty fields for the "none" sentinel', () => {
    expect(matchSpecial([], FILTER_NONE, matchValue)).toBe(true)
    expect(matchSpecial(['Fantasy'], FILTER_NONE, matchValue)).toBe(false)
  })

  it('matches populated fields for the "any" sentinel', () => {
    expect(matchSpecial(['Fantasy'], FILTER_ANY, matchValue)).toBe(true)
    expect(matchSpecial(null, FILTER_ANY, matchValue)).toBe(false)
  })

  it('delegates non-special values to the supplied matcher', () => {
    expect(matchSpecial('Fantasy', 'Fantasy', matchValue)).toBe(true)
    expect(matchSpecial('Fantasy', 'Horror', matchValue)).toBe(false)
  })
})

describe('splitSpecial', () => {
  it('separates sentinels from plain values', () => {
    const { values, pass } = splitSpecial([FILTER_ANY, 'Fantasy'], ['Fantasy'])
    expect(values).toEqual(['Fantasy'])
    expect(pass).toBe(true)
  })

  it('fails an item whose field is populated when "none" is selected', () => {
    expect(splitSpecial([FILTER_NONE], ['Fantasy']).pass).toBe(false)
    expect(splitSpecial([FILTER_NONE], []).pass).toBe(true)
  })

  it('fails an item whose field is empty when "any" is selected', () => {
    expect(splitSpecial([FILTER_ANY], []).pass).toBe(false)
    expect(splitSpecial([FILTER_ANY], ['Fantasy']).pass).toBe(true)
  })

  it('cannot pass when both sentinels are selected together', () => {
    expect(splitSpecial([FILTER_NONE, FILTER_ANY], ['Fantasy']).pass).toBe(false)
    expect(splitSpecial([FILTER_NONE, FILTER_ANY], []).pass).toBe(false)
  })

  it('defaults to an empty selection', () => {
    expect(splitSpecial()).toEqual({ values: [], pass: true })
  })
})

describe('withSpecialOptions', () => {
  it('prepends the two special entries with the supplied labels', () => {
    const out = withSpecialOptions([{ value: 'Fantasy', label: 'Fantasy' }], {
      none: 'No genre',
      any: 'Any genre',
    })
    expect(out).toEqual([
      { value: FILTER_NONE, label: 'No genre', special: true },
      { value: FILTER_ANY, label: 'Any genre', special: true },
      { value: 'Fantasy', label: 'Fantasy' },
    ])
  })
})
