import { describe, expect, it } from 'vitest'
import { guestScopeOf } from './guestScope'

describe('guestScopeOf', () => {
  it('is null for full accounts and the signed out', () => {
    expect(guestScopeOf(null)).toBeNull()
    expect(guestScopeOf({ role: 'player', guest_scope: 'wargame' })).toBeNull()
  })

  it('reads a guest’s scope, a campaign’s when none is stored', () => {
    expect(guestScopeOf({ role: 'guest', guest_scope: 'wargame' })).toBe('wargame')
    expect(guestScopeOf({ role: 'guest', guest_scope: 'ttrpg' })).toBe('ttrpg')
    expect(guestScopeOf({ role: 'guest' })).toBe('ttrpg')
  })
})
