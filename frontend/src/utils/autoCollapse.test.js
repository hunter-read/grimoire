import { describe, it, expect } from 'vitest'
import {
  AUTO_COLLAPSE_THRESHOLD,
  CORE_OPEN_MAX,
  shouldAutoCollapse,
  defaultCollapsedCategories,
} from './autoCollapse'

const books = (category, n) => Array.from({ length: n }, () => ({ category }))

describe('shouldAutoCollapse', () => {
  it('collapses only past the threshold', () => {
    expect(shouldAutoCollapse(AUTO_COLLAPSE_THRESHOLD, 3)).toBe(false)
    expect(shouldAutoCollapse(AUTO_COLLAPSE_THRESHOLD + 1, 3)).toBe(true)
  })

  it('leaves a lone group open however long it is', () => {
    expect(shouldAutoCollapse(500, 1)).toBe(false)
  })

  it('treats an unknown group count as many groups', () => {
    expect(shouldAutoCollapse(26)).toBe(true)
  })
})

describe('defaultCollapsedCategories', () => {
  it('collapses nothing for a short system', () => {
    expect(defaultCollapsedCategories([...books('core', 5), ...books('adventure', 20)])).toEqual(
      new Set()
    )
  })

  it('keeps a small core open and collapses every other category', () => {
    const result = defaultCollapsedCategories([
      ...books('core', CORE_OPEN_MAX),
      ...books('adventure', 15),
      ...books('supplement', 10),
    ])
    expect(result).toEqual(new Set(['adventure', 'supplement']))
  })

  it('collapses core too once it holds more than a few books', () => {
    const result = defaultCollapsedCategories([
      ...books('core', CORE_OPEN_MAX + 1),
      ...books('adventure', 25),
    ])
    expect(result).toEqual(new Set(['core', 'adventure']))
  })

  it('files uncategorised books under core', () => {
    const result = defaultCollapsedCategories([...books(undefined, 3), ...books('adventure', 30)])
    expect(result).toEqual(new Set(['adventure']))
  })

  it('leaves a single long category open', () => {
    expect(defaultCollapsedCategories(books('adventure', 40))).toEqual(new Set())
  })

  it('handles a system that has not loaded', () => {
    expect(defaultCollapsedCategories(undefined)).toEqual(new Set())
  })
})
