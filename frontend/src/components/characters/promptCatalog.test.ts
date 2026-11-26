import { describe, it, expect } from 'vitest'
import { catalogKey, entryKey, filterCatalog, loadCatalog, passesFilter } from './promptCatalog'
import { entryAnswer } from './sheetPrompts'
import type { PromptStep } from './sheetPrompts'

const FEAT: PromptStep = {
  key: 'feat',
  type: 'entry',
  content_type: 'feat',
  filters: { category: 'General' },
  filter: 'entry.level <= level',
}

describe('catalogKey', () => {
  it('is shared by steps reading the same content type with the same filters', () => {
    const one: PromptStep = { ...FEAT, filters: { a: 1, b: 'x' } }
    const two: PromptStep = {
      key: 'more',
      type: 'entries',
      content_type: 'feat',
      filters: { b: 'x', a: '1' },
    }
    expect(catalogKey(one)).toBe(catalogKey(two))
    expect(catalogKey({ ...one, filters: { a: 2, b: 'x' } })).not.toBe(catalogKey(one))
    expect(catalogKey({ ...one, content_type: 'spell' })).not.toBe(catalogKey(one))
  })

  it('is undefined for a step that reads no catalog', () => {
    expect(catalogKey({ key: 'n', type: 'number' })).toBeUndefined()
    expect(catalogKey({ key: 'e', type: 'entry' })).toBeUndefined()
  })
})

describe('loadCatalog', () => {
  it('reads every page, with the fixed filters, and keeps every entry', async () => {
    const pages: Record<number, { entry_id: string; name: string; data: { level: number } }[]> = {
      1: Array.from({ length: 200 }, (_, i) => ({
        entry_id: `f${i}`,
        name: `F${i}`,
        data: { level: i % 2 ? 1 : 8 },
      })),
      2: [{ entry_id: 'alert', name: 'Alert', data: { level: 1 } }],
    }
    const asked: unknown[][] = []
    const found = await loadCatalog(FEAT, async (...args) => {
      asked.push(args)
      return { entries: pages[args[2]] || [], total: 201 }
    })
    expect(asked).toEqual([
      ['feat', { category: 'General' }, 1, 200],
      ['feat', { category: 'General' }, 2, 200],
    ])
    // The filter formula is not the read's business.
    expect(found).toHaveLength(201)
    expect(found.at(-1)).toMatchObject({ _ref: 'alert', name: 'Alert', level: 1 })
  })

  it('stops at the last short page', async () => {
    let calls = 0
    await loadCatalog(FEAT, async () => {
      calls += 1
      return { entries: [{ entry_id: 'a', name: 'A' }] }
    })
    expect(calls).toBe(1)
  })
})

describe('passesFilter', () => {
  const alert = entryAnswer({ entry_id: 'alert', name: 'Alert', data: { level: 1 } })
  const boon = entryAnswer({ entry_id: 'boon', name: 'Boon', data: { level: 19 } })

  it('reads the candidate as entry beside the sheet', () => {
    expect(passesFilter(FEAT, alert, { level: 4 })).toBe(true)
    expect(passesFilter(FEAT, boon, { level: 4 })).toBe(false)
    expect(filterCatalog(FEAT, [alert, boon], { level: 20 })).toEqual([alert, boon])
  })

  it('lets everything through without a filter, and nothing through one that does not parse', () => {
    expect(passesFilter({ ...FEAT, filter: undefined }, boon, {})).toBe(true)
    expect(passesFilter({ ...FEAT, filter: 'entry.level <=' }, alert, { level: 4 })).toBe(false)
    // Remembered as broken, not parsed into something else the second time.
    expect(passesFilter({ ...FEAT, filter: 'entry.level <=' }, alert, { level: 4 })).toBe(false)
  })
})

describe('entryKey', () => {
  it('tells the same id from two sources apart', () => {
    expect(entryKey({ _ref: 'alert', _source: 'phb' })).not.toBe(
      entryKey({ _ref: 'alert', _source: 'xphb' })
    )
    expect(entryKey({ _ref: 'alert' })).toBe(':alert')
  })
})
