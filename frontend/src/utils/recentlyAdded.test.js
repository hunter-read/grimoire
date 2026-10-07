import { describe, it, expect } from 'vitest'
import { RECENTLY_ADDED_DAYS, addedAtTime, compareAddedAt, isRecentlyAdded } from './recentlyAdded'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

describe('addedAtTime', () => {
  it('parses an ISO timestamp with its offset', () => {
    expect(addedAtTime('2026-10-07T12:00:00+00:00')).toBe(NOW)
  })

  it('is null for a missing or unparseable date', () => {
    expect(addedAtTime(null)).toBeNull()
    expect(addedAtTime(undefined)).toBeNull()
    expect(addedAtTime('not a date')).toBeNull()
  })
})

describe('isRecentlyAdded', () => {
  it('is a week long', () => {
    expect(RECENTLY_ADDED_DAYS).toBe(7)
  })

  it('is true inside the window and false past it', () => {
    expect(isRecentlyAdded(new Date(NOW - DAY).toISOString(), NOW)).toBe(true)
    expect(isRecentlyAdded(new Date(NOW - 7 * DAY + 1000).toISOString(), NOW)).toBe(true)
    expect(isRecentlyAdded(new Date(NOW - 7 * DAY).toISOString(), NOW)).toBe(false)
    expect(isRecentlyAdded(new Date(NOW - 30 * DAY).toISOString(), NOW)).toBe(false)
  })

  it('is false for an item that predates tracking', () => {
    expect(isRecentlyAdded(null, NOW)).toBe(false)
  })
})

describe('compareAddedAt', () => {
  const old = { added_at: '2024-01-01T00:00:00Z' }
  const recent = { added_at: '2026-10-01T00:00:00Z' }
  const undated = { added_at: null }
  const sortBy = (dir) =>
    [undated, recent, old].sort((a, b) => compareAddedAt(a, b, dir)).map((i) => i.added_at)

  it('orders oldest first ascending and newest first descending', () => {
    expect(sortBy(1)).toEqual([old.added_at, recent.added_at, null])
    expect(sortBy(-1)).toEqual([recent.added_at, old.added_at, null])
  })

  it('ties two undated items so the caller can break them', () => {
    expect(compareAddedAt(undated, { added_at: undefined }, 1)).toBe(0)
  })
})
