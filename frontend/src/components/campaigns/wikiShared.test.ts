import { describe, it, expect } from 'vitest'
import { defaultCollapsedParents, descendantIds } from './wikiShared'

const page = (id, parent_id = null) => ({ id, parent_id })

// Two top-level pages, each with a run of children, past the auto-collapse
// threshold in total.
const longWiki = () => [
  page('a'),
  page('b'),
  page('a1', 'a'),
  ...Array.from({ length: 12 }, (_, i) => page(`a1-${i}`, 'a1')),
  ...Array.from({ length: 12 }, (_, i) => page(`b-${i}`, 'b')),
]

describe('defaultCollapsedParents', () => {
  it('collapses nothing before pages load or for a short wiki', () => {
    expect(defaultCollapsedParents(null)).toEqual(new Set())
    expect(defaultCollapsedParents([page('a'), page('b'), page('c', 'a')])).toEqual(new Set())
  })

  it('collapses every parent of a long wiki', () => {
    expect(defaultCollapsedParents(longWiki())).toEqual(new Set(['a', 'a1', 'b']))
  })

  it("keeps the open note's ancestors expanded", () => {
    expect(defaultCollapsedParents(longWiki(), 'a1-3')).toEqual(new Set(['b']))
  })

  it('leaves a wiki with a single top-level page open', () => {
    const pages = [page('root'), ...Array.from({ length: 30 }, (_, i) => page(`c${i}`, 'root'))]
    expect(defaultCollapsedParents(pages)).toEqual(new Set())
  })

  it('stops on a parent cycle instead of looping', () => {
    const pages = [...longWiki(), page('x', 'y'), page('y', 'x')]
    const result = defaultCollapsedParents(pages, 'x')
    expect(result.has('a')).toBe(true)
  })
})

describe('descendantIds', () => {
  it('returns the page and everything beneath it', () => {
    const pages = [page('a'), page('b', 'a'), page('c', 'b'), page('d')]
    expect(descendantIds('a', pages)).toEqual(new Set(['a', 'b', 'c']))
  })
})
