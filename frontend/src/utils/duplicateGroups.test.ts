import { describe, it, expect } from 'vitest'

import {
  filterGroups,
  groupMerge,
  isExactGroup,
  keeperScore,
  matchStrength,
  pickKeeper,
  type DuplicateGroup,
} from './duplicateGroups'

const member = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  filename: `${id}.pdf`,
  relative_path: `books/${id}.pdf`,
  ...extra,
})

const group = (
  members: ReturnType<typeof member>[],
  extra: Partial<DuplicateGroup> = {}
): DuplicateGroup => ({
  id: 'g',
  resource_type: 'book',
  confidence: 1,
  reasons: ['metadata'],
  members,
  ...extra,
})

describe('keeperScore / pickKeeper', () => {
  it('ranks a present file over a missing one, then pages, then size', () => {
    expect(keeperScore(null)).toBe(-1)
    const missing = member('m', { is_missing: true, page_count: 900 })
    const short = member('s', { page_count: 10, file_size: 999 })
    const long = member('l', { page_count: 20, file_size: 1 })
    expect(pickKeeper(group([missing, short, long]))?.id).toBe('l')
  })

  it('ignores references: they move with the merge', () => {
    const bookmarked = member('b', { file_size: 1, reference_counts: { bookmarks: 40 } })
    const bigger = member('f', { file_size: 2 })
    expect(pickKeeper(group([bookmarked, bigger]))?.id).toBe('f')
  })

  it("breaks a tie with the scan's suggestion", () => {
    const g = group([member('a'), member('b')], { suggested_parent_id: 'b' })
    expect(pickKeeper(g)?.id).toBe('b')
  })

  it('has no keeper for an empty group', () => {
    expect(pickKeeper(group([]))).toBeNull()
    expect(pickKeeper(null)).toBeNull()
  })
})

describe('match strength', () => {
  it('calls a group exact only when every file is identical', () => {
    const same = group([member('a', { content_hash: 'h' }), member('b', { content_hash: 'h' })])
    const partly = group([member('a', { content_hash: 'h' }), member('b')], { reasons: ['hash'] })
    expect(isExactGroup(same)).toBe(true)
    expect(matchStrength(same)).toBe('exact')
    expect(isExactGroup(partly)).toBe(false)
    expect(matchStrength(partly)).toBe('metadata')
    expect(matchStrength(group([member('a'), member('b')], { reasons: ['text'] }))).toBe('text')
  })

  it('filters by type and strength', () => {
    const exact = group([member('a', { content_hash: 'h' }), member('b', { content_hash: 'h' })], {
      id: 'e',
    })
    const map = group([member('m'), member('n')], { id: 'm', resource_type: 'map' })
    expect(filterGroups([exact, map]).map((g) => g.id)).toEqual(['e', 'm'])
    expect(filterGroups([exact, map], { type: 'map' }).map((g) => g.id)).toEqual(['m'])
    expect(filterGroups([exact, map], { match: 'exact' }).map((g) => g.id)).toEqual(['e'])
    expect(filterGroups(null)).toEqual([])
  })
})

describe('groupMerge', () => {
  it('merges every other member into the keeper', () => {
    const g = group([member('a'), member('b', { page_count: 3 }), member('c')])
    expect(groupMerge(g)).toEqual({ resource_type: 'book', keep_id: 'b', merge_ids: ['a', 'c'] })
  })
})
