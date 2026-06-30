import { describe, it, expect } from 'vitest'
import { TYPE_ICONS, RESOURCE_NAV, VISIBILITY_OPTIONS, selectStyle } from './resourcesShared'

describe('resourcesShared', () => {
  it('has icons for every resource type including audio', () => {
    for (const type of ['book', 'map', 'token', 'audio', 'file']) {
      expect(TYPE_ICONS[type]).toBeTruthy()
      expect(TYPE_ICONS[type].Icon).toBeTruthy()
    }
  })

  it('builds navigation paths for library resource types', () => {
    expect(RESOURCE_NAV.book('b1')).toBe('/library/book/b1')
    expect(RESOURCE_NAV.map('m1')).toBe('/maps/m1')
    expect(RESOURCE_NAV.token('t1')).toBe('/tokens/t1')
    expect(RESOURCE_NAV.audio('a1')).toBe('/audio/a1')
  })

  it('exposes visibility options in priority order', () => {
    expect(VISIBILITY_OPTIONS).toEqual(['public', 'private', 'gm'])
  })

  it('exposes a select style object', () => {
    expect(selectStyle).toHaveProperty('cursor', 'pointer')
  })
})
