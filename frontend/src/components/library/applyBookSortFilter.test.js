import { describe, it, expect } from 'vitest'
import { bookFilterPredicate, bookComparator } from './applyBookSortFilter'
import { FILTER_NONE, FILTER_ANY } from './specialFilters'

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

  it('filters by genre', () => {
    const p = bookFilterPredicate({ genres: 'Fantasy' })
    expect(books.filter(p).map((b) => b.id)).toEqual(['a'])
  })

  // Genre was a multi-select before it was aligned with the systems genre
  // filter, so a preset saved back then still holds a one-element array.
  it('reads a legacy array genre value as its first entry', () => {
    const p = bookFilterPredicate({ genres: ['Fantasy'] })
    expect(books.filter(p).map((b) => b.id)).toEqual(['a'])
  })

  it('filters by a legacy flat tag list (AND)', () => {
    const p = bookFilterPredicate({ tags: ['osr', 'grim'] })
    expect(books.filter(p).map((b) => b.id)).toEqual(['c'])
  })

  it('filters by grouped tags: osr AND (grim OR missing)', () => {
    const p = bookFilterPredicate({
      tags: [
        { mode: 'include', tags: ['osr'] },
        { mode: 'include', tags: ['grim', 'missing'] },
      ],
    })
    expect(books.filter(p).map((b) => b.id)).toEqual(['c'])
  })

  it('excludes a tag group', () => {
    const p = bookFilterPredicate({ tags: [{ mode: 'exclude', tags: ['grim'] }] })
    expect(books.filter(p).map((b) => b.id)).toEqual(['a'])
  })

  it('filters by favorites via isFavorite', () => {
    const p = bookFilterPredicate({ favorites: true }, { isFavorite: (id) => id === 'b' })
    expect(books.filter(p).map((b) => b.id)).toEqual(['b'])
  })

  describe('special presence filters', () => {
    it('filters to books with no genre', () => {
      const p = bookFilterPredicate({ genres: FILTER_NONE })
      expect(books.filter(p).map((b) => b.id)).toEqual(['c'])
    })

    it('filters to books that have any genre', () => {
      const p = bookFilterPredicate({ genres: FILTER_ANY })
      expect(books.filter(p).map((b) => b.id)).toEqual(['a', 'b'])
    })

    it('filters to books with no tags', () => {
      const p = bookFilterPredicate({ tags: [FILTER_NONE] })
      expect(books.filter(p).map((b) => b.id)).toEqual([])
    })

    it('combines a genre sentinel with a tag filter on the other field', () => {
      const p = bookFilterPredicate({ genres: FILTER_ANY, tags: ['grim'] })
      expect(books.filter(p).map((b) => b.id)).toEqual(['b'])
    })

    // A group ORs its terms, so "no tags OR any tags" covers everything — and
    // excluding that covers nothing.
    it('excludes everything when a group ORs both sentinels in exclude mode', () => {
      const p = bookFilterPredicate({
        tags: [{ mode: 'exclude', tags: [FILTER_NONE, FILTER_ANY] }],
      })
      expect(books.filter(p)).toHaveLength(0)
    })

    it('keeps everything when a group ORs both sentinels in include mode', () => {
      const p = bookFilterPredicate({
        tags: [{ mode: 'include', tags: [FILTER_NONE, FILTER_ANY] }],
      })
      expect(books.filter(p)).toHaveLength(3)
    })
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
