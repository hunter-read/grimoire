import { describe, it, expect } from 'vitest'
import { bookFilterParams, browseKey, commonFilterParams, toQuery, withQuery } from './browseParams'
import { FILTER_NONE } from '../components/library/specialFilters'

describe('toQuery / withQuery', () => {
  it('drops undefined and null but keeps an empty string', () => {
    expect(toQuery({ a: 1, b: undefined, c: null, folder: '' })).toBe('a=1&folder=')
  })

  it('appends to a path with or without a query already', () => {
    expect(withQuery('/maps', { limit: 1 })).toBe('/maps?limit=1')
    expect(withQuery('/maps?x=1', { limit: 1 })).toBe('/maps?x=1&limit=1')
    expect(withQuery('/maps', {})).toBe('/maps')
  })
})

describe('commonFilterParams', () => {
  it('maps the filter state to the server parameters', () => {
    const now = Date.parse('2026-10-10T00:00:00Z')
    const params = commonFilterParams(
      { search: '  goblin ', tags: ['forest'], favorites: true, recent: true },
      now
    )
    expect(params.q).toBe('goblin')
    expect(JSON.parse(params.tags)).toEqual([{ mode: 'include', tags: ['forest'] }])
    expect(params.favorites).toBe('true')
    expect(params.added_since).toBe('2026-10-03T00:00:00.000Z')
  })

  it('leaves unset filters out', () => {
    expect(commonFilterParams({})).toEqual({
      q: undefined,
      tags: undefined,
      favorites: undefined,
      added_since: undefined,
    })
    expect(commonFilterParams({ tags: [{ mode: 'include', tags: [] }] }).tags).toBeUndefined()
  })
})

describe('bookFilterParams', () => {
  it('adds the shelf select filters', () => {
    const params = bookFilterParams({ explicit: false, genres: ['Horror'], productCode: 'PZO' })
    expect(params).toMatchObject({ explicit: 'false', genre: 'Horror', product_code: 'PZO' })
  })

  it('passes the presence sentinels through', () => {
    expect(bookFilterParams({ genres: FILTER_NONE }).genre).toBe(FILTER_NONE)
  })
})

describe('browseKey', () => {
  it('changes with the filters and the order, not the recent cut-off', () => {
    const a = browseKey({ recent: true }, 'name', 'asc')
    expect(browseKey({ recent: true }, 'name', 'asc')).toBe(a)
    expect(browseKey({ recent: true }, 'size', 'asc')).not.toBe(a)
    expect(browseKey({ search: 'x' }, 'name', 'asc')).not.toBe(browseKey({}, 'name', 'asc'))
  })
})
