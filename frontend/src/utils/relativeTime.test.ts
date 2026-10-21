import { describe, it, expect } from 'vitest'
import { formatDateTime, formatRelative, parseUtc, recency } from './relativeTime'

const NOW = new Date('2026-10-21T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('parseUtc', () => {
  it('reads a naive server timestamp as UTC', () => {
    expect(parseUtc('2026-10-21T12:00:00')?.toISOString()).toBe('2026-10-21T12:00:00.000Z')
  })

  it('keeps an explicit offset', () => {
    expect(parseUtc('2026-10-21T14:00:00+02:00')?.toISOString()).toBe('2026-10-21T12:00:00.000Z')
  })

  it('returns null for nothing or garbage', () => {
    expect(parseUtc(null)).toBeNull()
    expect(parseUtc(undefined)).toBeNull()
    expect(parseUtc('not a date')).toBeNull()
  })
})

describe('formatRelative', () => {
  it.each([
    [ago(20 * 1000), 'now'],
    [ago(5 * MIN), '5 minutes ago'],
    [ago(3 * HOUR), '3 hours ago'],
    [ago(DAY), 'yesterday'],
    [ago(12 * DAY), '12 days ago'],
    [ago(90 * DAY), '3 months ago'],
    [ago(800 * DAY), '2 years ago'],
  ])('formats %s as %s', (date, expected) => {
    expect(formatRelative(date, 'en-US', NOW)).toBe(expected)
  })

  it('never reads a slightly-future clock as "in ..."', () => {
    expect(formatRelative(new Date(NOW.getTime() + 30 * 1000), 'en-US', NOW)).toBe('now')
  })

  it('follows the locale', () => {
    expect(formatRelative(ago(DAY), 'de-DE', NOW)).toBe('gestern')
  })
})

describe('formatDateTime', () => {
  it('includes the date and the time', () => {
    const text = formatDateTime(NOW, 'en-US')
    expect(text).toMatch(/2026/)
    expect(text).toMatch(/:00/)
  })
})

describe('recency', () => {
  it.each([
    [null, 'never'],
    [ago(HOUR), 'day'],
    [ago(5 * DAY), 'month'],
    [ago(60 * DAY), 'older'],
  ] as const)('buckets %s as %s', (date, expected) => {
    expect(recency(date, NOW)).toBe(expected)
  })
})
