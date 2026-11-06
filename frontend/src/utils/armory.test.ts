import { describe, expect, it } from 'vitest'
import { libraryBase, showArmoryNav, systemPath } from './armory'

describe('armory helpers', () => {
  it('opens wargames under /armory and everything else under /library', () => {
    expect(libraryBase('wargame')).toBe('/armory')
    expect(libraryBase('ttrpg')).toBe('/library')
    expect(libraryBase(undefined)).toBe('/library')
    expect(systemPath({ id: 's1', game_type: 'wargame' })).toBe('/armory/system/s1')
    expect(systemPath({ id: 's2' })).toBe('/library/system/s2')
  })

  it('lists the Armory once it holds a book, or for an admin, unless hidden', () => {
    expect(showArmoryNav({ armoryBooks: 0, isAdmin: false })).toBe(false)
    expect(showArmoryNav({ armoryBooks: null, isAdmin: false })).toBe(false)
    expect(showArmoryNav({ armoryBooks: 3, isAdmin: false })).toBe(true)
    expect(showArmoryNav({ armoryBooks: 0, isAdmin: true })).toBe(true)
    expect(showArmoryNav({ hidden: true, armoryBooks: 3, isAdmin: true })).toBe(false)
  })
})
