import { describe, it, expect } from 'vitest'
import { CHARACTER_STATUSES, isActive, statusLabel } from './characterStatus'
import { placeableCampaigns } from './useCharacterCampaigns'

const t = (key) => key

describe('characterStatus', () => {
  it('matches the server set', () => {
    expect(CHARACTER_STATUSES).toEqual(['active', 'retired', 'dead'])
  })

  it('treats a missing status as active', () => {
    expect(isActive({})).toBe(true)
    expect(isActive(null)).toBe(true)
    expect(isActive({ status: 'dead' })).toBe(false)
  })

  it('labels unknown statuses as active', () => {
    expect(statusLabel(t, 'retired')).toBe('characters.statusRetired')
    expect(statusLabel(t, 'ascended')).toBe('characters.statusActive')
  })
})

describe('placeableCampaigns', () => {
  it('accepts either list shape and drops pending invitations', () => {
    const rows = [
      { id: 'a', invitation_status: null },
      { id: 'b', invitation_status: 'invited' },
    ]
    expect(placeableCampaigns(rows).map((c) => c.id)).toEqual(['a'])
    expect(placeableCampaigns({ campaigns: rows }).map((c) => c.id)).toEqual(['a'])
    expect(placeableCampaigns(null)).toEqual([])
  })
})
