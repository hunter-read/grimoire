import { describe, it, expect } from 'vitest'
import { bookFilterPredicate, bookComparator } from './applyBookSortFilter'

const books = [
  {
    id: 'a',
    title: 'Alpha',
    year: 2015,
    page_count: 100,
    file_size: 10,
    is_explicit: false,
    genres: ['Fantasy'],
    tags: ['osr'],
  },
  {
    id: 'b',
    title: 'Beta',
    year: 2020,
    page_count: 40,
    file_size: 50,
    is_explicit: true,
    genres: ['Horror'],
    tags: ['grim'],
  },
  {
    id: 'c',
    title: 'Gamma',
    year: null,
    page_count: 250,
    file_size: 5,
    is_explicit: false,
    genres: [],
    tags: ['osr', 'grim'],
  },
]

describe('bookFilterPredicate', () => {
  it('passes everything with no filters', () => {
    const p = bookFilterPredicate({})
    expect(books.filter(p)).toHaveLength(3)
  })

  it('filters by explicit', () => {
    const p = bookFilterPredicate({ explicit: true })
    expect(books.filter(p).map((b) => b.id)).toEqual(['b'])
  })

  it('filters by genre (AND)', () => {
    const p = bookFilterPredicate({ genres: ['Fantasy'] })
    expect(books.filter(p).map((b) => b.id)).toEqual(['a'])
  })

  it('filters by multiple tags (AND)', () => {
    const p = bookFilterPredicate({ tags: ['osr', 'grim'] })
    expect(books.filter(p).map((b) => b.id)).toEqual(['c'])
  })

  it('filters by favorites via isFavorite', () => {
    const p = bookFilterPredicate({ favorites: true }, { isFavorite: (id) => id === 'b' })
    expect(books.filter(p).map((b) => b.id)).toEqual(['b'])
  })
})

describe('bookComparator', () => {
  it('sorts by title ascending', () => {
    const out = [...books].sort(bookComparator('title', 'asc')).map((b) => b.id)
    expect(out).toEqual(['a', 'b', 'c'])
  })

  it('sorts by page_count descending', () => {
    const out = [...books].sort(bookComparator('page_count', 'desc')).map((b) => b.id)
    expect(out).toEqual(['c', 'a', 'b'])
  })

  it('sorts null years last (ascending)', () => {
    const out = [...books].sort(bookComparator('year', 'asc')).map((b) => b.id)
    expect(out[out.length - 1]).toBe('c')
  })
})
