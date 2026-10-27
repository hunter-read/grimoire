import { describe, it, expect } from 'vitest'
import {
  ALL,
  EXPIRY_CHOICES,
  effectiveLevel,
  expiryFromDays,
  formatWhen,
  grantedPermissions,
  rank,
} from './apiKeyUtils'

describe('apiKeyUtils', () => {
  it('offers 30 / 90 / 365 days and never', () => {
    expect(EXPIRY_CHOICES).toEqual([30, 90, 365, null])
  })

  it('turns a day count into an ISO timestamp, and never into null', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(expiryFromDays(30, now)).toBe('2026-01-31T00:00:00.000Z')
    expect(expiryFromDays(null, now)).toBeNull()
  })

  it('formats naive and aware timestamps, and tolerates junk', () => {
    expect(formatWhen('2026-08-01T10:00:00', 'en-US')).toMatch(/2026/)
    expect(formatWhen('2026-08-01T10:00:00+00:00', 'en-US')).toMatch(/2026/)
    expect(formatWhen(null, 'en-US')).toBeNull()
    expect(formatWhen('not a date', 'en-US')).toBeNull()
  })

  it('lists granted permissions in server order, skipping none', () => {
    const perms = [{ id: 'stats' }, { id: 'books' }, { id: 'maps' }]
    const key = { permissions: { maps: 'write', stats: 'read', books: 'none' } }
    expect(grantedPermissions(key, perms)).toEqual([
      { id: 'stats', level: 'read' },
      { id: 'maps', level: 'write' },
    ])
    expect(grantedPermissions({}, perms)).toEqual([])
  })

  it('ranks levels, treating unknown as none', () => {
    expect(rank('write')).toBeGreaterThan(rank('read'))
    expect(rank('read')).toBeGreaterThan(rank('none'))
    expect(rank(undefined)).toBe(0)
  })

  it('takes the higher of an explicit level and All permissions, capped by the area', () => {
    const books = { id: 'books', levels: ['none', 'read', 'write'] }
    const stats = { id: 'stats', levels: ['none', 'read'] }
    expect(effectiveLevel({}, books)).toBe('none')
    expect(effectiveLevel({ [ALL]: 'read' }, books)).toBe('read')
    expect(effectiveLevel({ [ALL]: 'read', books: 'write' }, books)).toBe('write')
    expect(effectiveLevel({ [ALL]: 'write' }, stats)).toBe('read')
  })

  it('summarises All permissions first, then only areas raised above it', () => {
    const perms = [{ id: 'stats' }, { id: 'books' }, { id: 'maps' }]
    const key = { permissions: { [ALL]: 'read', books: 'write', maps: 'read' } }
    expect(grantedPermissions(key, perms)).toEqual([
      { id: ALL, level: 'read' },
      { id: 'books', level: 'write' },
    ])
  })
})
