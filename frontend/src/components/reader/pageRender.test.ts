import { describe, it, expect } from 'vitest'
import {
  PAGE_WIDTH,
  PRELOAD_CACHE_MAX,
  SPREAD_WIDTH,
  TEXT_CACHE_MAX,
  pruneCache,
} from './pageRender'

describe('page render constants', () => {
  it('exposes the widths the preloader and page components share', () => {
    expect(PAGE_WIDTH).toBe(1600)
    expect(SPREAD_WIDTH).toBe(1000)
  })

  it('caps the preload cache above the widest prefetch window', () => {
    // Spread mode prefetches ahead 12 + behind 4 + 2 visible; the cap must
    // exceed that or the preloader would evict pages it just requested.
    expect(PRELOAD_CACHE_MAX).toBeGreaterThan(12 + 4 + 2)
  })
})

describe('pruneCache', () => {
  const refOf = (obj) => ({ current: obj })

  it('leaves a cache under the cap untouched', () => {
    const ref = refOf({ a: 1, b: 2 })
    pruneCache(ref, 5)
    expect(ref.current).toEqual({ a: 1, b: 2 })
  })

  it('leaves a cache exactly at the cap untouched', () => {
    const ref = refOf({ a: 1, b: 2 })
    pruneCache(ref, 2)
    expect(Object.keys(ref.current)).toEqual(['a', 'b'])
  })

  it('evicts the oldest entries when over the cap', () => {
    const ref = refOf({ a: 1, b: 2, c: 3, d: 4 })
    pruneCache(ref, 2)
    expect(Object.keys(ref.current)).toEqual(['c', 'd'])
  })

  it('keeps the most recently inserted entry, which is the visible page', () => {
    const ref = refOf({})
    for (let p = 1; p <= 50; p++) ref.current[`${p}`] = p
    pruneCache(ref, 10)
    expect(ref.current['50']).toBe(50)
    expect(ref.current['1']).toBeUndefined()
  })

  it('bounds a cache across repeated inserts rather than growing', () => {
    const ref = refOf({})
    for (let p = 1; p <= 500; p++) {
      ref.current[`${p}`] = p
      pruneCache(ref, TEXT_CACHE_MAX)
      expect(Object.keys(ref.current).length).toBeLessThanOrEqual(TEXT_CACHE_MAX)
    }
    expect(Object.keys(ref.current).length).toBe(TEXT_CACHE_MAX)
  })

  it('handles an empty cache', () => {
    const ref = refOf({})
    pruneCache(ref, 10)
    expect(ref.current).toEqual({})
  })
})
