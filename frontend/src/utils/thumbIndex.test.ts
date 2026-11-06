import { describe, it, expect } from 'vitest'
import {
  MAX_TAB,
  MIN_TAB,
  buildRuns,
  decadeKey,
  indexLetter,
  mergeTabs,
  sectionId,
  tabHeight,
  tabMatches,
  type IndexEntry,
} from './thumbIndex'

const entry = (label: string, count: number, preview: string[] = []): IndexEntry => ({
  key: label,
  label,
  count,
  preview,
})

describe('indexLetter', () => {
  it('folds accents and case onto the first letter', () => {
    expect(indexLetter('Mörk Borg')).toBe('M')
    expect(indexLetter('élan')).toBe('E')
    expect(indexLetter('apple')).toBe('A')
  })

  it('files digits, symbols and blanks under #', () => {
    expect(indexLetter('13th Age')).toBe('#')
    expect(indexLetter('7th Sea')).toBe('#')
    expect(indexLetter('')).toBe('#')
    expect(indexLetter(null)).toBe('#')
    expect(indexLetter('!!!')).toBe('#')
  })

  it('skips leading punctuation to the first letter', () => {
    expect(indexLetter('"Troika!"')).toBe('T')
    expect(indexLetter('(The) Black Hack')).toBe('T')
  })

  it('keeps a letter from another script', () => {
    expect(indexLetter('жар-птица')).toBe('Ж')
  })

  it('upper-cases in the given locale', () => {
    expect(indexLetter('istanbul', 'tr')).toBe('İ')
  })
})

describe('decadeKey', () => {
  it('names the decade', () => {
    expect(decadeKey(1994)).toBe('1990s')
    expect(decadeKey(2020)).toBe('2020s')
  })

  it('files an unknown year under #', () => {
    expect(decadeKey(null)).toBe('#')
    expect(decadeKey(undefined)).toBe('#')
    expect(decadeKey(Infinity)).toBe('#')
  })
})

describe('buildRuns', () => {
  const names = ['Apple', 'Avocado', 'Banana', 'Cherry', 'Citrus', 'Clementine']

  it('cuts the list into runs with counts and a preview', () => {
    const runs = buildRuns(names, (n) => indexLetter(n), { nameOf: (n) => n })
    expect(runs.map((r) => [r.key, r.count, r.items])).toEqual([
      ['A', 2, ['Apple', 'Avocado']],
      ['B', 1, ['Banana']],
      ['C', 3, ['Cherry', 'Citrus', 'Clementine']],
    ])
    expect(runs[2].preview).toEqual(['Cherry', 'Citrus', 'Clementine'])
  })

  it('caps the preview at four names', () => {
    const runs = buildRuns(['a1', 'a2', 'a3', 'a4', 'a5'], () => 'A', { nameOf: (n) => n })
    expect(runs[0].preview).toHaveLength(4)
    expect(runs[0].count).toBe(5)
  })

  it('totals what the rows hold', () => {
    const runs = buildRuns([3, 4, 10], (n) => (n < 5 ? 'A' : 'B'), { unitsOf: (n) => n })
    expect(runs.map((r) => r.units)).toEqual([7, 10])
  })

  it('gives a key seen again its own run and a unique key', () => {
    const runs = buildRuns(['1', 'a', '~'], (n) => (n === 'a' ? 'A' : '#'))
    expect(runs.map((r) => [r.key, r.label])).toEqual([
      ['#', '#'],
      ['A', 'A'],
      ['#~1', '#'],
    ])
  })

  it('has no units or preview when not asked for', () => {
    const [run] = buildRuns(['x'], () => 'X')
    expect(run.units).toBeUndefined()
    expect(run.preview).toEqual([])
  })
})

describe('mergeTabs', () => {
  const entries = [
    entry('A', 30, ['Alpha']),
    entry('B', 20),
    entry('Q', 1, ['Quest']),
    entry('X', 1),
    entry('Y', 2),
    entry('Z', 1, ['Zweihänder']),
  ]

  it('keeps a tab per run when there is room', () => {
    const tabs = mergeTabs(entries, 10)
    expect(tabs.map((t) => t.label)).toEqual(['A', 'B', 'Q', 'X', 'Y', 'Z'])
    expect(tabs[0].keys).toEqual(['A'])
  })

  it('merges the quietest neighbours into ranges first', () => {
    const tabs = mergeTabs(entries, 3)
    expect(tabs.map((t) => t.label)).toEqual(['A', 'B', 'Q–Z'])
    expect(tabs[2]).toMatchObject({ count: 5, keys: ['Q', 'X', 'Y', 'Z'] })
    expect(tabs[2].preview).toEqual(['Quest', 'Zweihänder'])
  })

  it('carries the first run’s offset and sums units', () => {
    const tabs = mergeTabs(
      [
        { ...entry('A', 1), offset: 0, units: 3 },
        { ...entry('B', 1), offset: 1, units: 4 },
      ],
      1
    )
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ label: 'A–B', offset: 0, units: 7 })
  })

  it('never goes below one tab', () => {
    expect(mergeTabs(entries, 0)).toHaveLength(1)
  })
})

describe('tabHeight', () => {
  it('shares the space, within the target bounds', () => {
    expect(tabHeight(280, 10)).toBe(28)
    expect(tabHeight(100, 10)).toBe(MIN_TAB)
    expect(tabHeight(1000, 10)).toBe(MAX_TAB)
    expect(tabHeight(1000, 0)).toBe(MAX_TAB)
  })
})

describe('sectionId', () => {
  it('makes a safe, unique id from a key', () => {
    expect(sectionId('maps', 'A')).toBe('idx-maps-A')
    expect(sectionId('maps', '#~1')).not.toMatch(/[#%\s]/)
    expect(sectionId('maps', 'É')).not.toBe(sectionId('maps', 'E'))
  })
})

describe('tabMatches', () => {
  it('matches its own letter and anything inside a range', () => {
    expect(tabMatches({ label: 'M' }, 'm')).toBe(true)
    expect(tabMatches({ label: 'U–Z' }, 'w')).toBe(true)
    expect(tabMatches({ label: 'U–Z' }, 'z')).toBe(true)
    expect(tabMatches({ label: 'U–Z' }, 't')).toBe(false)
    expect(tabMatches({ label: '#' }, '7')).toBe(true)
  })

  it('does not treat a long label as a range of letters', () => {
    expect(tabMatches({ label: '1990s' }, '9')).toBe(false)
    expect(tabMatches({ label: 'Nov 26' }, 'n')).toBe(false)
  })
})
