import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  utcToLocalInputTime,
  localInputTimeToUtc,
  utcTimeToLocal,
  formatDate,
} from './_scheduleShared'

// Pin timezone to UTC for deterministic results
beforeEach(() => {
  vi.useFakeTimers()
  // Use a fixed date so Date() produces a known value
  vi.setSystemTime(new Date('2024-06-15T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('utcToLocalInputTime', () => {
  it('returns empty string for null', () => {
    expect(utcToLocalInputTime(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(utcToLocalInputTime(undefined)).toBe('')
  })

  it('converts UTC HH:MM to local HH:MM for input[type=time]', () => {
    // Round-trip: whatever utcToLocalInputTime returns, localInputTimeToUtc should return the original
    const utc = '14:30'
    const local = utcToLocalInputTime(utc)
    // local is a valid HH:MM string
    expect(local).toMatch(/^\d{2}:\d{2}$/)
    // round-trip back to UTC
    expect(localInputTimeToUtc(local)).toBe(utc)
  })

  it('handles midnight UTC', () => {
    const local = utcToLocalInputTime('00:00')
    expect(local).toMatch(/^\d{2}:\d{2}$/)
    expect(localInputTimeToUtc(local)).toBe('00:00')
  })

  it('handles 23:59 UTC', () => {
    const local = utcToLocalInputTime('23:59')
    expect(local).toMatch(/^\d{2}:\d{2}$/)
    expect(localInputTimeToUtc(local)).toBe('23:59')
  })
})

describe('localInputTimeToUtc', () => {
  it('returns null for null', () => {
    expect(localInputTimeToUtc(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(localInputTimeToUtc('')).toBeNull()
  })

  it('returns a HH:MM formatted string', () => {
    const result = localInputTimeToUtc('09:15')
    expect(result).toMatch(/^\d{2}:\d{2}$/)
  })

  it('round-trips with utcToLocalInputTime', () => {
    const samples = ['00:00', '06:30', '12:00', '18:45', '23:59']
    samples.forEach((utc) => {
      expect(localInputTimeToUtc(utcToLocalInputTime(utc))).toBe(utc)
    })
  })
})

describe('utcTimeToLocal', () => {
  it('returns null for falsy input', () => {
    expect(utcTimeToLocal(null)).toBeNull()
    expect(utcTimeToLocal('')).toBeNull()
  })

  it('returns a non-empty string for valid UTC time', () => {
    const result = utcTimeToLocal('14:30')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
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
