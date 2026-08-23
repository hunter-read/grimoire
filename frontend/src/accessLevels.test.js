import { describe, it, expect } from 'vitest'
import {
  ACCESS_ADMIN,
  ACCESS_GM,
  ACCESS_INHERIT,
  ACCESS_OPEN,
  UNRESTRICTABLE_CATEGORIES,
  fromPickerValue,
  isRestricted,
  toPickerValue,
} from './accessLevels'

describe('accessLevels', () => {
  it('maps null and undefined to the inherit sentinel', () => {
    expect(toPickerValue(null)).toBe(ACCESS_INHERIT)
    expect(toPickerValue(undefined)).toBe(ACCESS_INHERIT)
  })

  it('keeps an explicit open distinct from inherit', () => {
    // The distinction the three-state column exists for: "" overrides a
    // restricted system, null does not.
    expect(toPickerValue(ACCESS_OPEN)).toBe(ACCESS_OPEN)
    expect(toPickerValue(ACCESS_OPEN)).not.toBe(ACCESS_INHERIT)
  })

  it('passes real levels through unchanged', () => {
    expect(toPickerValue(ACCESS_GM)).toBe(ACCESS_GM)
    expect(toPickerValue(ACCESS_ADMIN)).toBe(ACCESS_ADMIN)
  })

  it('round-trips picker values', () => {
    expect(fromPickerValue(ACCESS_INHERIT)).toBe(ACCESS_INHERIT)
    expect(fromPickerValue(ACCESS_GM)).toBe(ACCESS_GM)
    expect(fromPickerValue(ACCESS_OPEN)).toBe(ACCESS_OPEN)
  })

  it('treats only gm and admin as restricted', () => {
    expect(isRestricted(ACCESS_GM)).toBe(true)
    expect(isRestricted(ACCESS_ADMIN)).toBe(true)
    expect(isRestricted(ACCESS_OPEN)).toBe(false)
    expect(isRestricted(null)).toBe(false)
  })

  it('never allows restricting core rules or character sheets', () => {
    expect(UNRESTRICTABLE_CATEGORIES).toContain('core')
    expect(UNRESTRICTABLE_CATEGORIES).toContain('character-sheet')
  })
})
