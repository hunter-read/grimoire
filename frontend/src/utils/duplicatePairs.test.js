import { describe, it, expect } from 'vitest'
import { parentScore, pickParent, groupToPairs, groupsToPairs } from './duplicatePairs'

const member = (id, extra = {}) => ({
  id,
  filename: `${id}.pdf`,
  relative_path: `books/${id}.pdf`,
  file_size: 1000,
  ...extra,
})

const group = (extra = {}) => ({
  id: 'g1',
  resource_type: 'book',
  reason_text: 'identical files',
  reasons: ['hash'],
  confidence: 1,
  members: [member('a'), member('b')],
  ...extra,
})

describe('parentScore', () => {
  it('prefers the copy carrying user work over a bigger file', () => {
    const withRefs = member('a', { file_size: 1, reference_counts: { bookmarks: 2 } })
    const bigger = member('b', { file_size: 999999999 })
    expect(parentScore(withRefs)).toBeGreaterThan(parentScore(bigger))
  })

  it('prefers more pages when neither carries user work', () => {
    expect(parentScore(member('a', { page_count: 320 }))).toBeGreaterThan(
      parentScore(member('b', { page_count: 12 }))
    )
  })

  it('falls back to file size when pages tie', () => {
    expect(parentScore(member('a', { page_count: 10, file_size: 20 }))).toBeGreaterThan(
      parentScore(member('b', { page_count: 10, file_size: 10 }))
    )
  })

  it('ranks a missing file below any present one', () => {
    const missing = member('a', { is_missing: true, reference_counts: { bookmarks: 99 } })
    expect(parentScore(missing)).toBeLessThan(parentScore(member('b')))
  })

  it('scores a nullish member below everything', () => {
    expect(parentScore(null)).toBe(-1)
  })
})

describe('pickParent', () => {
  it("honours the scan's suggestion", () => {
    const g = group({ suggested_parent_id: 'b' })
    expect(pickParent(g).id).toBe('b')
  })

  it('falls back to the best member when the suggestion is gone', () => {
    const g = group({
      suggested_parent_id: 'missing-id',
      members: [member('a'), member('b', { page_count: 400 })],
    })
    expect(pickParent(g).id).toBe('b')
  })

  it('returns null for an empty group', () => {
    expect(pickParent(group({ members: [] }))).toBeNull()
    expect(pickParent(null)).toBeNull()
  })
})

describe('groupToPairs', () => {
  it('turns five members into four parent-vs-child pairs, not ten', () => {
    const g = group({
      suggested_parent_id: 'a',
      members: ['a', 'b', 'c', 'd', 'e'].map((id) => member(id)),
    })
    const pairs = groupToPairs(g)
    expect(pairs).toHaveLength(4)
    // The parent is on every pair; each child appears exactly once.
    expect(pairs.every((p) => p.parent.id === 'a')).toBe(true)
    expect(pairs.map((p) => p.child.id)).toEqual(['b', 'c', 'd', 'e'])
  })

  it('gives each pair a stable, distinct key', () => {
    const g = group({ suggested_parent_id: 'a', members: [member('a'), member('b'), member('c')] })
    const keys = groupToPairs(g).map((p) => p.pairKey)
    expect(new Set(keys).size).toBe(2)
    // Stable across calls, so a resolved pair stays identifiable.
    expect(groupToPairs(g).map((p) => p.pairKey)).toEqual(keys)
  })

  it('carries the group provenance onto every pair', () => {
    const pairs = groupToPairs(group({ suggested_parent_id: 'a' }))
    expect(pairs[0]).toMatchObject({
      groupId: 'g1',
      resourceType: 'book',
      reasonText: 'identical files',
      confidence: 1,
    })
  })

  it('yields nothing for a group with no members', () => {
    expect(groupToPairs(group({ members: [] }))).toEqual([])
  })

  it('yields nothing when the group holds only the parent', () => {
    expect(groupToPairs(group({ members: [member('a')] }))).toEqual([])
  })
})

describe('groupsToPairs', () => {
  it('flattens several groups in order', () => {
    const g1 = group({ id: 'g1', suggested_parent_id: 'a' })
    const g2 = group({
      id: 'g2',
      suggested_parent_id: 'x',
      members: [member('x'), member('y'), member('z')],
    })
    const pairs = groupsToPairs([g1, g2])
    expect(pairs).toHaveLength(3)
    expect(pairs.map((p) => p.groupId)).toEqual(['g1', 'g2', 'g2'])
  })

  it('tolerates a nullish list', () => {
    expect(groupsToPairs(null)).toEqual([])
  })
})

describe('groupToPairs with recorded edges', () => {
  it('shows only the pairs that actually matched', () => {
    // D resembles A, B and C; the real duplicate is A-B. Union-find puts all
    // four in one cluster, but reviewing "D versus everything" would invent
    // three pairs that never matched and hide the one that did.
    const g = group({
      members: ['a', 'b', 'c', 'd'].map((id) => member(id)),
      suggested_parent_id: 'd',
      edges: [
        { a: 'a', b: 'b', reason: 'hash', score: 1 },
        { a: 'd', b: 'c', reason: 'metadata', score: 0.8 },
      ],
    })
    const pairs = groupToPairs(g)
    expect(pairs).toHaveLength(2)
    const asSets = pairs.map((p) => [p.parent.id, p.child.id].sort().join('-'))
    expect(asSets).toContain('a-b')
    expect(asSets).toContain('c-d')
    // Never a pair that only ever existed transitively.
    expect(asSets).not.toContain('a-d')
  })

  it('scores each pair by its own edge, not the group maximum', () => {
    const g = group({
      members: [member('a'), member('b'), member('c')],
      edges: [
        { a: 'a', b: 'b', reason: 'hash', score: 1 },
        { a: 'b', b: 'c', reason: 'metadata', score: 0.72 },
      ],
    })
    const scores = groupToPairs(g).map((p) => p.confidence)
    expect(scores).toEqual([1, 0.72])
  })

  it('labels a pair by the signal that fired for it', () => {
    const g = group({
      members: [member('a'), member('b')],
      edges: [{ a: 'a', b: 'b', reason: 'text', score: 0.6 }],
    })
    expect(groupToPairs(g)[0].reasonText).toBe('overlapping text')
  })

  it('ignores edges pointing at a member that is gone', () => {
    const g = group({
      members: [member('a'), member('b')],
      edges: [
        { a: 'a', b: 'b', reason: 'hash', score: 1 },
        { a: 'a', b: 'vanished', reason: 'metadata', score: 0.8 },
      ],
    })
    expect(groupToPairs(g)).toHaveLength(1)
  })

  it('orients each pair so the stronger candidate is the proposed parent', () => {
    const g = group({
      members: [member('a'), member('b', { reference_counts: { bookmarks: 3 } })],
      edges: [{ a: 'a', b: 'b', reason: 'hash', score: 1 }],
    })
    expect(groupToPairs(g)[0].parent.id).toBe('b')
  })

  it('falls back to parent-versus-all when no edges were recorded', () => {
    // Groups written before edges were persisted must still be reviewable.
    const g = group({
      suggested_parent_id: 'a',
      members: ['a', 'b', 'c'].map((id) => member(id)),
    })
    const pairs = groupToPairs(g)
    expect(pairs).toHaveLength(2)
    expect(pairs.every((p) => p.parent.id === 'a')).toBe(true)
  })
})
