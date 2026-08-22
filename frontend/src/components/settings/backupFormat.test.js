import { describe, it, expect } from 'vitest'
import { formatBytes, formatTimestamp, relativeAge } from './backupFormat'

describe('formatBytes', () => {
  it('renders bytes and KB without decimals', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
  })

  it('renders MB and GB with one decimal', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })

  it('handles zero and missing values', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(undefined)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
  })
})

describe('formatTimestamp', () => {
  it('formats an ISO timestamp', () => {
    const out = formatTimestamp('2026-08-21T14:03:55Z', 'en-US')
    expect(out).toMatch(/2026/)
  })

  it('returns empty string for an unparseable value', () => {
    expect(formatTimestamp('not-a-date')).toBe('')
  })
})

describe('relativeAge', () => {
  const now = new Date('2026-08-21T12:00:00Z').getTime()

  it('reports sub-minute ages as just now', () => {
    expect(relativeAge('2026-08-21T11:59:30Z', now)).toEqual({ unit: 'justNow', count: 0 })
  })

  it('reports minutes, hours, and days', () => {
    expect(relativeAge('2026-08-21T11:30:00Z', now)).toEqual({ unit: 'minutes', count: 30 })
    expect(relativeAge('2026-08-21T09:00:00Z', now)).toEqual({ unit: 'hours', count: 3 })
    expect(relativeAge('2026-08-18T12:00:00Z', now)).toEqual({ unit: 'days', count: 3 })
  })

  it('never reports a negative age for a future timestamp', () => {
    expect(relativeAge('2026-08-22T12:00:00Z', now)).toEqual({ unit: 'justNow', count: 0 })
  })

  it('returns null for an unparseable value', () => {
    expect(relativeAge('nope', now)).toBeNull()
  })
})
