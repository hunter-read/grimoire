import { describe, it, expect } from 'vitest'
import { formatSize, formatDuration, toTitleCase } from './utils'

describe('formatSize', () => {
  it('returns bytes for values under 1 KB', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(1)).toBe('1 B')
    expect(formatSize(1023)).toBe('1023 B')
  })

  it('returns KB for values between 1 KB and 1 MB', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(1048575)).toBe('1024.0 KB')
  })

  it('returns MB for values 1 MB and above', () => {
    expect(formatSize(1048576)).toBe('1.0 MB')
    expect(formatSize(2097152)).toBe('2.0 MB')
    expect(formatSize(1572864)).toBe('1.5 MB')
  })

  it('formats MB to one decimal place', () => {
    expect(formatSize(10485760)).toBe('10.0 MB')
    expect(formatSize(10737418)).toBe('10.2 MB')
  })
})

describe('formatDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(125)).toBe('2:05')
  })

  it('formats hours as h:mm:ss', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(7325)).toBe('2:02:05')
  })

  it('handles null/undefined and rounds', () => {
    expect(formatDuration(null)).toBe('0:00')
    expect(formatDuration(undefined)).toBe('0:00')
    expect(formatDuration(59.6)).toBe('1:00')
  })
})

describe('toTitleCase', () => {
  it('replaces dashes/underscores and capitalizes words', () => {
    expect(toTitleCase('battle-maps')).toBe('Battle Maps')
    expect(toTitleCase('sound_effects')).toBe('Sound Effects')
  })

  it('keeps well-known acronyms in canonical casing', () => {
    expect(toTitleCase('gm-tools')).toBe('GM Tools')
    expect(toTitleCase('npc-portraits')).toBe('NPC Portraits')
    expect(toTitleCase('one-page-rpgs')).toBe('One Page RPGs')
  })

  it('leaves an empty/falsey input untouched', () => {
    expect(toTitleCase('')).toBe('')
    expect(toTitleCase(undefined)).toBe(undefined)
  })
})
