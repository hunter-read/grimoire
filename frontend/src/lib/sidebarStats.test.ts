import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import type { Schema } from '../api'
import {
  MAX_SIDEBAR_STATS,
  STAT_GROUPS,
  STAT_IDS,
  cleanLayout,
  defaultLayout,
  formatSize,
  formatStat,
  resolveLayout,
} from './sidebarStats'

const t = ((key: string, options?: { size?: string | number }) =>
  key === 'common.sizeGB' ? `${options?.size} GB` : `${options?.size} MB`) as unknown as TFunction

describe('defaultLayout', () => {
  it('uses the saved default', () => {
    expect(defaultLayout({ sidebar_stats: ['maps', 'ttrpg_books'] })).toEqual([
      'maps',
      'ttrpg_books',
    ])
  })

  it('falls back to the older flags, with their old defaults, before the settings load', () => {
    expect(defaultLayout({})).toEqual(['game_systems', 'total_pages', 'total_size_mb'])
    expect(defaultLayout({ show_stat_pages: false, show_stat_audio: true })).toEqual([
      'game_systems',
      'audio',
      'total_size_mb',
    ])
  })
})

describe('resolveLayout', () => {
  it("prefers the user's own layout, even an empty one", () => {
    expect(resolveLayout(['audio'], { sidebar_stats: ['maps'] })).toEqual(['audio'])
    expect(resolveLayout([], { sidebar_stats: ['maps'] })).toEqual([])
  })

  it('follows the default without one', () => {
    expect(resolveLayout(null, { sidebar_stats: ['maps'] })).toEqual(['maps'])
    expect(resolveLayout(undefined, { sidebar_stats: ['maps'] })).toEqual(['maps'])
  })
})

describe('cleanLayout', () => {
  it('drops unknown and repeated stats and stops at the maximum', () => {
    const layout = cleanLayout(['maps', 'not_a_stat', 'maps', 7, ...STAT_IDS])
    expect(layout[0]).toBe('maps')
    expect(layout).not.toContain('not_a_stat')
    expect(new Set(layout).size).toBe(layout.length)
    expect(layout).toHaveLength(MAX_SIDEBAR_STATS)
  })
})

describe('formatting', () => {
  const stats = {
    total_pages: 45000,
    library_size_mb: 2048,
    maps_size_mb: 12.5,
  } as Schema<'StatsResponse'>

  it('groups counts and shows sizes in MB or GB', () => {
    expect(formatStat(t, stats, 'total_pages')).toBe((45000).toLocaleString())
    expect(formatStat(t, stats, 'library_size_mb')).toBe('2.00 GB')
    expect(formatStat(t, stats, 'maps_size_mb')).toBe('12.5 MB')
  })

  it('reads a missing value as zero', () => {
    expect(formatStat(t, stats, 'wargame_books')).toBe('0')
    expect(formatSize(t, undefined)).toBe('0 MB')
  })
})

describe('STAT_GROUPS', () => {
  it('puts every stat in exactly one group', () => {
    const grouped = STAT_GROUPS.flatMap((group) => group.stats)
    expect([...grouped].sort()).toEqual([...STAT_IDS].sort())
  })
})
