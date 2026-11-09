import { describe, expect, it } from 'vitest'
import { homePath, libraryBase, showArmoryNav, systemPath } from './armory'

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

  it('lands on the Library, or with it hidden on the first shelf still listed', () => {
    expect(homePath({})).toBe('/library')
    expect(homePath({ hide_library: true })).toBe('/armory')
    expect(homePath({ hide_library: true, hide_armory: true })).toBe('/maps')
    expect(
      homePath({
        hide_library: true,
        hide_armory: true,
        hide_maps: true,
        hide_tokens: true,
        hide_audio: true,
      })
    ).toBe('/models')
    expect(
      homePath({
        hide_library: true,
        hide_armory: true,
        hide_maps: true,
        hide_tokens: true,
        hide_audio: true,
        hide_models: true,
      })
    ).toBe('/search')
  })
})
