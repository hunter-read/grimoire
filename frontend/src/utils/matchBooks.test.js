import { describe, it, expect } from 'vitest'
import matchBooks from './matchBooks'

const books = [
  { id: '1', title: 'Curse of Strahd', tags: ['ravenloft'], description: 'A gothic adventure' },
  { id: '2', title: "Player's Handbook", tags: ['core', 'strahd-cameo'], authors: ['WotC'] },
  { id: '3', title: 'Volo', tags: [], description: 'monsters', publisher: 'Wizards', year: 2016 },
]

describe('matchBooks', () => {
  it('returns [] for an empty query', () => {
    expect(matchBooks(books, '')).toEqual([])
    expect(matchBooks(books, '   ')).toEqual([])
  })

  it('matches on title', () => {
    const r = matchBooks(books, 'strahd')
    expect(r.map((b) => b.id)).toContain('1')
  })

  it('ranks a title match above a tag match', () => {
    // Both book 1 (title) and book 2 (tag "strahd-cameo") contain "strahd".
    const r = matchBooks(books, 'strahd')
    expect(r[0].id).toBe('1')
  })

  it('matches on metadata (publisher, year)', () => {
    expect(matchBooks(books, 'wizards').map((b) => b.id)).toEqual(['3'])
    expect(matchBooks(books, '2016').map((b) => b.id)).toEqual(['3'])
  })

  it('requires every term to appear (AND semantics)', () => {
    // "curse" is in book 1's title, "monsters" only in book 3 — no book has both.
    expect(matchBooks(books, 'curse monsters')).toEqual([])
    // Both terms in book 1.
    expect(matchBooks(books, 'curse gothic').map((b) => b.id)).toEqual(['1'])
  })

  it('is case-insensitive', () => {
    expect(matchBooks(books, 'CURSE').map((b) => b.id)).toEqual(['1'])
  })

  it('handles missing/empty book fields safely', () => {
    expect(matchBooks([{ id: 'x', title: 'Bare' }], 'bare').map((b) => b.id)).toEqual(['x'])
    expect(matchBooks(null, 'anything')).toEqual([])
  })
})
