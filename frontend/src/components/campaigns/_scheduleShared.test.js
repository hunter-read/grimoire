import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatScheduleTime, formatDate } from './_scheduleShared'

// Pin timezone to UTC for deterministic results
beforeEach(() => {
  vi.useFakeTimers()
  // Use a fixed date so Date() produces a known value
  vi.setSystemTime(new Date('2024-06-15T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('formatScheduleTime', () => {
  it('returns null for falsy input', () => {
    expect(formatScheduleTime(null)).toBeNull()
    expect(formatScheduleTime('')).toBeNull()
  })

  it('formats a stored local HH:MM without converting it', () => {
    // Schedule times are stored in the zone they were picked in, so the hour
    // shown must match the hour stored. Converting to and from UTC is what
    // dropped the day rollover and published evening games a day early.
    expect(formatScheduleTime('19:30')).toMatch(/7:30/)
  })

  it('formats midnight and end-of-day without shifting', () => {
    expect(formatScheduleTime('00:00')).toMatch(/12:00/)
    expect(formatScheduleTime('23:59')).toMatch(/11:59/)
  })
})

describe('formatDate', () => {
  it('returns empty object for falsy input', () => {
    expect(formatDate(null)).toEqual({})
    expect(formatDate('')).toEqual({})
  })

  it('returns short and weekday keys for a valid date string', () => {
    const result = formatDate('2024-06-15')
    expect(result).toHaveProperty('short')
    expect(result).toHaveProperty('weekday')
    expect(typeof result.short).toBe('string')
    expect(typeof result.weekday).toBe('string')
    expect(result.short.length).toBeGreaterThan(0)
  })
})
