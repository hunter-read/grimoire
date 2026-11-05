import { describe, it, expect } from 'vitest'
import { CONFIG, diffDrafts, seedDrafts, type BulkEditRow } from './bulkEditDrafts'

const book = (access_level: string | null): BulkEditRow => ({
  id: 'b1',
  title: 'Alpha',
  tags: [],
  access_level,
  effective_access_level: 'gm',
})

// The access level of one book after editing its draft: the field it would
// send, or undefined when nothing would be sent.
const bookAccessPatch = (stored: string | null, edited: string | null) => {
  const items = [book(stored)]
  const drafts = seedDrafts(items, CONFIG.book)
  drafts.b1.access_level = edited
  return diffDrafts(items, drafts, CONFIG.book).b1?.access_level
}

describe('bulk edit drafts: book access level', () => {
  it('seeds the stored level, null meaning inherit, and what inherit resolves to', () => {
    expect(seedDrafts([book(null)], CONFIG.book).b1).toMatchObject({
      access_level: null,
      effective_access_level: 'gm',
    })
    expect(seedDrafts([book('')], CONFIG.book).b1.access_level).toBe('')
  })

  it('sends a changed level', () => {
    expect(bookAccessPatch(null, 'gm')).toBe('gm')
    expect(bookAccessPatch('gm', 'admin')).toBe('admin')
  })

  it('sends inherit as "inherit", and an explicit open as ""', () => {
    expect(bookAccessPatch('gm', 'inherit')).toBe('inherit')
    expect(bookAccessPatch('gm', null)).toBe('inherit')
    expect(bookAccessPatch(null, '')).toBe('')
  })

  it('sends nothing when the level is unchanged', () => {
    expect(bookAccessPatch(null, null)).toBeUndefined()
    // The picker reports inherit as the string; still the same level.
    expect(bookAccessPatch(null, 'inherit')).toBeUndefined()
    expect(bookAccessPatch('gm', 'gm')).toBeUndefined()
  })
})

describe('bulk edit drafts: system access level', () => {
  const system = (access_level: string | null): BulkEditRow => ({
    id: 's1',
    tags: [],
    access_level,
  })
  const patchFor = (stored: string | null, edited: string) => {
    const items = [system(stored)]
    const drafts = seedDrafts(items, CONFIG.system)
    drafts.s1.access_level = edited
    return diffDrafts(items, drafts, CONFIG.system).s1?.access_level
  }

  it('sends a changed level', () => {
    expect(patchFor(null, 'admin')).toBe('admin')
    expect(patchFor('gm', '')).toBe('')
  })

  it('treats null and "" as the same open level', () => {
    expect(seedDrafts([system(null)], CONFIG.system).s1.access_level).toBe('')
    expect(patchFor(null, '')).toBeUndefined()
  })
})
