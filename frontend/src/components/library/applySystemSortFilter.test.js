import { describe, it, expect } from 'vitest'
import { applySystemSortFilter } from './applySystemSortFilter'

const systems = [
  {
    id: 'a',
    name: 'Alpha',
    book_count: 2,
    total_page_count: 100,
    year: 2015,
    is_explicit: false,
    genres: ['Fantasy'],
    system_family: 'd20 System',
    parent_system: 'Dungeons & Dragons',
    edition: '5e',
  },
  {
    id: 'b',
    name: 'Beta',
    book_count: 5,
    total_page_count: 40,
    year: 2020,
    is_explicit: true,
    genres: ['Science Fiction'],
    system_family: 'Fate',
  },
  {
    id: 'c',
    name: 'Gamma',
    book_count: 1,
    total_page_count: 250,
    year: null,
    is_explicit: false,
    genres: [],
    system_family: '',
  },
]

describe('applySystemSortFilter', () => {
  it('sorts by name ascending by default', () => {
    const out = applySystemSortFilter(systems, {})
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by book_count descending', () => {
    const out = applySystemSortFilter(systems, { sort: 'book_count', order: 'desc' })
    expect(out.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })

  it('sorts by page_count ascending', () => {
    const out = applySystemSortFilter(systems, { sort: 'page_count', order: 'asc' })
    expect(out.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })

  it('sorts null years last', () => {
    const out = applySystemSortFilter(systems, { sort: 'year', order: 'asc' })
    expect(out[out.length - 1].id).toBe('c')
  })

  it('filters by genre', () => {
    const out = applySystemSortFilter(systems, { filters: { genre: 'Fantasy' } })
    expect(out.map((s) => s.id)).toEqual(['a'])
  })

  it('filters by family', () => {
    const out = applySystemSortFilter(systems, { filters: { family: 'Fate' } })
    expect(out.map((s) => s.id)).toEqual(['b'])
  })

  it('filters by parent_system', () => {
    const out = applySystemSortFilter(systems, {
      filters: { parent_system: 'Dungeons & Dragons' },
    })
    expect(out.map((s) => s.id)).toEqual(['a'])
  })

  it('filters by edition', () => {
    const out = applySystemSortFilter(systems, { filters: { edition: '5e' } })
    expect(out.map((s) => s.id)).toEqual(['a'])
  })

  it('filters by explicit', () => {
    const out = applySystemSortFilter(systems, { filters: { explicit: true } })
    expect(out.map((s) => s.id)).toEqual(['b'])
  })

  it('does not mutate the input array', () => {
    const copy = [...systems]
    applySystemSortFilter(systems, { sort: 'book_count', order: 'desc' })
    expect(systems).toEqual(copy)
  })
})
