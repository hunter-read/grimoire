import { describe, it, expect } from 'vitest'
import { CAMPAIGN_EMOJI, EMOJI_GROUP_KEYS, searchEmoji } from './campaignEmoji'

describe('emoji catalogue', () => {
  it('exposes a non-trivial, duplicate-free set', () => {
    expect(CAMPAIGN_EMOJI.length).toBeGreaterThan(100)
    expect(new Set(CAMPAIGN_EMOJI).size).toBe(CAMPAIGN_EMOJI.length)
  })

  it('names its groups', () => {
    expect(EMOJI_GROUP_KEYS).toContain('creatures')
    expect(EMOJI_GROUP_KEYS).toContain('combat')
  })
})

describe('searchEmoji', () => {
  it('returns everything for an empty query', () => {
    expect(searchEmoji('')).toHaveLength(CAMPAIGN_EMOJI.length)
    expect(searchEmoji('  ')).toHaveLength(CAMPAIGN_EMOJI.length)
  })

  it('finds an emoji by keyword', () => {
    expect(searchEmoji('dragon')).toContain('🐉')
    expect(searchEmoji('sword')).toContain('⚔️')
  })

  it('finds an emoji by its group name', () => {
    expect(searchEmoji('creatures')).toContain('🐉')
  })

  it('is case insensitive', () => {
    expect(searchEmoji('Dragon')).toContain('🐉')
  })

  it('requires every term to match', () => {
    expect(searchEmoji('dragon wyrm')).toContain('🐉')
    expect(searchEmoji('dragon sword')).toHaveLength(0)
  })

  it('returns an empty list when nothing matches', () => {
    expect(searchEmoji('zzzznotanemoji')).toEqual([])
  })
})
