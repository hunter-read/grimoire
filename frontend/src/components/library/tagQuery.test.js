import { describe, it, expect } from 'vitest'
import { FILTER_ANY, FILTER_NONE } from './specialFilters'
import {
  GROUP_EXCLUDE,
  GROUP_INCLUDE,
  describeQuery,
  emptyGroup,
  isEmptyQuery,
  matchesTagQuery,
  pruneGroups,
  queryTags,
  toGroups,
  toggleQueryTag,
} from './tagQuery'

const inc = (...tags) => ({ mode: GROUP_INCLUDE, tags })
const exc = (...tags) => ({ mode: GROUP_EXCLUDE, tags })

describe('toGroups', () => {
  it('returns no groups for empty values', () => {
    expect(toGroups(undefined)).toEqual([])
    expect(toGroups(null)).toEqual([])
    expect(toGroups([])).toEqual([])
    expect(toGroups('nonsense')).toEqual([])
  })

  it('reads a legacy flat list as an AND of single-tag groups', () => {
    expect(toGroups(['osr', 'grim'])).toEqual([inc('osr'), inc('grim')])
  })

  it('passes groups through, defaulting an unknown mode to include', () => {
    expect(toGroups([{ mode: 'weird', tags: ['a'] }])).toEqual([inc('a')])
    expect(toGroups([exc('a')])).toEqual([exc('a')])
  })

  it('drops malformed entries', () => {
    expect(toGroups([null, { mode: GROUP_INCLUDE }, inc('a', 7)])).toEqual([inc('a')])
  })
})

describe('pruneGroups / isEmptyQuery', () => {
  it('drops groups with no tags', () => {
    expect(pruneGroups([inc('a'), inc()])).toEqual([inc('a')])
  })

  it('reports an all-empty query as empty', () => {
    expect(isEmptyQuery([inc(), exc()])).toBe(true)
    expect(isEmptyQuery(undefined)).toBe(true)
    expect(isEmptyQuery([inc('a')])).toBe(false)
  })

  it('builds an empty group in the requested mode', () => {
    expect(emptyGroup()).toEqual(inc())
    expect(emptyGroup(GROUP_EXCLUDE)).toEqual(exc())
  })
})

describe('queryTags', () => {
  it('flattens the concrete tags and drops sentinels and duplicates', () => {
    expect(queryTags([inc('osr', FILTER_ANY), exc('osr', 'grim')])).toEqual(['osr', 'grim'])
  })
})

describe('matchesTagQuery', () => {
  it('passes everything when the query is empty', () => {
    expect(matchesTagQuery(undefined, ['a'])).toBe(true)
    expect(matchesTagQuery([inc()], [])).toBe(true)
  })

  it('ORs within a group and ANDs across groups', () => {
    const q = [inc('building'), inc('store', 'shop')]
    expect(matchesTagQuery(q, ['building', 'shop'])).toBe(true)
    expect(matchesTagQuery(q, ['building', 'store'])).toBe(true)
    expect(matchesTagQuery(q, ['building'])).toBe(false)
    expect(matchesTagQuery(q, ['shop'])).toBe(false)
  })

  it('excludes with a "none of" group', () => {
    const q = [inc('building'), exc('ruined', 'wip')]
    expect(matchesTagQuery(q, ['building'])).toBe(true)
    expect(matchesTagQuery(q, ['building', 'ruined'])).toBe(false)
    expect(matchesTagQuery(q, ['building', 'wip'])).toBe(false)
  })

  it('matches case-insensitively', () => {
    expect(matchesTagQuery([inc('Building')], ['building'])).toBe(true)
    expect(matchesTagQuery([inc('building')], ['BUILDING'])).toBe(true)
  })

  it('evaluates the presence sentinels against the whole field', () => {
    expect(matchesTagQuery([inc(FILTER_NONE)], [])).toBe(true)
    expect(matchesTagQuery([inc(FILTER_NONE)], ['a'])).toBe(false)
    expect(matchesTagQuery([inc(FILTER_ANY)], ['a'])).toBe(true)
    expect(matchesTagQuery([inc(FILTER_ANY)], [])).toBe(false)
    expect(matchesTagQuery([exc(FILTER_ANY)], [])).toBe(true)
  })

  it('treats sentinels inside a group as alternatives, not a contradiction', () => {
    expect(matchesTagQuery([inc(FILTER_NONE, FILTER_ANY)], ['a'])).toBe(true)
    expect(matchesTagQuery([inc(FILTER_NONE, FILTER_ANY)], [])).toBe(true)
  })

  it('ORs a sentinel with a concrete tag in the same group', () => {
    const q = [inc(FILTER_NONE, 'osr')]
    expect(matchesTagQuery(q, [])).toBe(true)
    expect(matchesTagQuery(q, ['osr'])).toBe(true)
    expect(matchesTagQuery(q, ['grim'])).toBe(false)
  })

  it('handles a missing field', () => {
    expect(matchesTagQuery([inc('a')], undefined)).toBe(false)
    expect(matchesTagQuery([inc(FILTER_NONE)], undefined)).toBe(true)
  })
})

describe('toggleQueryTag', () => {
  it('adds a tag as a new ANDed group', () => {
    expect(toggleQueryTag(undefined, 'osr')).toEqual([inc('osr')])
    expect(toggleQueryTag([inc('osr')], 'grim')).toEqual([inc('osr'), inc('grim')])
  })

  it('removes a tag wherever it appears, dropping emptied groups', () => {
    expect(toggleQueryTag([inc('osr'), inc('grim', 'osr')], 'osr')).toEqual([inc('grim')])
    expect(toggleQueryTag([inc('osr')], 'osr')).toEqual([])
  })

  it('matches case-insensitively when removing', () => {
    expect(toggleQueryTag([inc('OSR')], 'osr')).toEqual([])
  })

  it('does not treat an excluded tag as already present', () => {
    expect(toggleQueryTag([exc('osr')], 'osr')).toEqual([exc('osr'), inc('osr')])
  })
})

describe('describeQuery', () => {
  const labels = { and: 'AND', or: 'OR', not: 'NOT', none: 'No tags', any: 'Any tags' }

  it('renders an empty query as an empty string', () => {
    expect(describeQuery([], labels)).toBe('')
  })

  it('renders the worked example', () => {
    const q = [inc('Building'), inc('store', 'shop')]
    expect(describeQuery(q, labels)).toBe('Building AND (store OR shop)')
  })

  it('parenthesises an excluded group', () => {
    expect(describeQuery([inc('a'), exc('ruined')], labels)).toBe('a AND NOT (ruined)')
  })

  it('names the sentinels', () => {
    expect(describeQuery([inc(FILTER_NONE)], labels)).toBe('No tags')
    expect(describeQuery([inc(FILTER_ANY)], labels)).toBe('Any tags')
  })

  it('falls back to English joiners with no labels', () => {
    expect(describeQuery([inc('a'), inc('b')])).toBe('a AND b')
  })
})
