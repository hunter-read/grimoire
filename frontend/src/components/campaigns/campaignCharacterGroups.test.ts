import { describe, it, expect } from 'vitest'
import { groupByOwner } from './campaignCharacterGroups'
import type { CampaignCharacter } from './campaignCharacterGroups'

const character = (overrides: Partial<CampaignCharacter>): CampaignCharacter => ({
  id: overrides.name || 'x',
  name: '',
  schema_ref: 'demo',
  status: 'active',
  ...overrides,
})

describe('groupByOwner', () => {
  it('puts the GM first, then the viewer, then everyone else by name', () => {
    const groups = groupByOwner(
      [
        character({ name: 'Zed', user_id: 'p2', owner_name: 'zoe' }),
        character({ name: 'Ann', user_id: 'p1', owner_name: 'adam' }),
        character({ name: 'Mine', user_id: 'me', owner_name: 'yolanda' }),
        character({ name: 'Innkeeper', user_id: 'gm', owner_name: 'the gm' }),
      ],
      { gmId: 'gm', viewerId: 'me' }
    )
    expect(groups.map((g) => g.userId)).toEqual(['gm', 'me', 'p1', 'p2'])
    expect(groups[0].isGm).toBe(true)
    expect(groups[1].isGm).toBe(false)
  })

  it('keeps the played characters apart from the retired and the dead', () => {
    const [group] = groupByOwner(
      [
        character({ name: 'Third', user_id: 'p1', status: 'dead' }),
        character({ name: 'Fourth', user_id: 'p1' }),
        character({ name: 'Second', user_id: 'p1', status: 'retired' }),
        character({ name: 'First', user_id: 'p1', status: 'dead' }),
      ],
      { gmId: 'gm', viewerId: 'me' }
    )
    expect(group.active.map((c) => c.name)).toEqual(['Fourth'])
    // The server's order stands for the fallen: most recently changed first.
    expect(group.inactive.map((c) => c.name)).toEqual(['Third', 'Second', 'First'])
  })

  it('sorts a player’s current characters by name', () => {
    const [group] = groupByOwner(
      [
        character({ name: 'bravo', user_id: 'gm' }),
        character({ name: 'Alpha', user_id: 'gm' }),
        character({ name: '', user_id: 'gm' }),
      ],
      { gmId: 'gm' }
    )
    expect(group.active.map((c) => c.name)).toEqual(['', 'Alpha', 'bravo'])
  })

  it('returns nothing for no characters', () => {
    expect(groupByOwner([], {})).toEqual([])
  })
})
