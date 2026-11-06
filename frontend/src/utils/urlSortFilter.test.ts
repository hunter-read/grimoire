import { describe, it, expect } from 'vitest'
import {
  decodeSortFilter,
  encodeSortFilter,
  sortFilterPart,
  sortFilterQuery,
  withSortFilter,
} from './urlSortFilter'

const DEFAULTS = { sort: 'name', order: 'asc', filters: {} }

describe('encodeSortFilter', () => {
  it('leaves an untouched view out of the address', () => {
    expect(encodeSortFilter(DEFAULTS, DEFAULTS)).toEqual([])
  })

  it('spells each filter as its own parameter', () => {
    const pairs = encodeSortFilter(
      {
        sort: 'added_at',
        order: 'desc',
        filters: {
          search: 'cave',
          favorites: true,
          explicit: false,
          genre: 'Horror',
          tags: [{ mode: 'include', tags: ['lava'] }],
          empty: '',
          none: [],
          gone: undefined,
        },
      },
      DEFAULTS
    )
    expect(pairs).toEqual([
      ['sort', 'added_at'],
      ['order', 'desc'],
      ['explicit', 'false'],
      ['favorites', 'true'],
      ['genre', 'Horror'],
      ['q', 'cave'],
      ['tags', '[{"mode":"include","tags":["lava"]}]'],
    ])
  })

  it('never writes the folder or sort names from the filters', () => {
    expect(encodeSortFilter({ filters: { folder: 'x', sort: 'y' } as never })).toEqual([])
  })
})

describe('decodeSortFilter', () => {
  it('is null when the address names no sort or filter', () => {
    expect(decodeSortFilter(new URLSearchParams('folder=Caves'), DEFAULTS)).toBeNull()
    expect(decodeSortFilter(new URLSearchParams(''), DEFAULTS)).toBeNull()
  })

  it('reads back what encodeSortFilter wrote', () => {
    const state = {
      sort: 'size',
      order: 'desc',
      filters: { search: 'orc', recent: true, explicit: false, tags: { a: 1 }, genre: 'Fantasy' },
    }
    const params = new URLSearchParams(encodeSortFilter(state, DEFAULTS))
    expect(decodeSortFilter(params, DEFAULTS)).toEqual(state)
  })

  it('keeps the defaults for what is not named', () => {
    expect(decodeSortFilter(new URLSearchParams('q=orc'), DEFAULTS)).toEqual({
      sort: 'name',
      order: 'asc',
      filters: { search: 'orc' },
    })
  })

  it('reads an unknown order as ascending and broken JSON as text', () => {
    expect(decodeSortFilter(new URLSearchParams('order=sideways&tags=[oops'), DEFAULTS)).toEqual({
      sort: 'name',
      order: 'asc',
      filters: { tags: '[oops' },
    })
  })
})

describe('address helpers', () => {
  it('replaces the sort/filter part and keeps the folder', () => {
    const next = withSortFilter(new URLSearchParams('folder=Caves&q=old&sort=size'), [['q', 'new']])
    expect(next.toString()).toBe('folder=Caves&q=new')
  })

  it('reads just the sort/filter part', () => {
    const params = new URLSearchParams('folder=Caves&q=orc&sort=size')
    expect(sortFilterPart(params)).toBe(
      sortFilterQuery([
        ['q', 'orc'],
        ['sort', 'size'],
      ])
    )
  })
})
