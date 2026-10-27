import { describe, it, expect } from 'vitest'
import { buildEmbedGroups } from './embedPickerGroups'

const label = (type) => type.toUpperCase()

const res = (id, type, categoryId) => ({
  id,
  resource_type: type,
  resource_id: id,
  name: id,
  category_id: categoryId,
})

describe('buildEmbedGroups', () => {
  it('groups by type when the campaign has no categories', () => {
    const groups = buildEmbedGroups([res('b1', 'book'), res('m1', 'map')], [], [], label)
    expect(groups.map((g) => g.key)).toEqual(['type:book', 'type:map'])
    expect(groups[0].items).toHaveLength(1)
  })

  it('drops groups with no items', () => {
    const groups = buildEmbedGroups([res('b1', 'book')], [], [], label)
    expect(groups.map((g) => g.key)).toEqual(['type:book'])
  })

  it('puts custom categories first, in sort order', () => {
    const cats = [
      { id: 'c2', name: 'Lore', sort_order: 2 },
      { id: 'c1', name: 'Handouts', sort_order: 1 },
    ]
    const groups = buildEmbedGroups(
      [res('b1', 'book', 'c2'), res('m1', 'map', 'c1'), res('t1', 'token')],
      cats,
      [],
      label
    )
    expect(groups.map((g) => g.label)).toEqual(['Handouts', 'Lore', 'TOKEN'])
  })

  it('honours the saved group order', () => {
    const cats = [{ id: 'c1', name: 'Handouts', sort_order: 1 }]
    const groups = buildEmbedGroups(
      [res('b1', 'book'), res('m1', 'map', 'c1')],
      cats,
      ['type:book', 'cat:c1'],
      label
    )
    expect(groups.map((g) => g.key)).toEqual(['type:book', 'cat:c1'])
  })

  it('falls back to the type group when a category no longer exists', () => {
    const groups = buildEmbedGroups([res('b1', 'book', 'gone')], [], [], label)
    expect(groups.map((g) => g.key)).toEqual(['type:book'])
    expect(groups[0].items[0].id).toBe('b1')
  })

  it('tolerates null resources, categories and order', () => {
    expect(buildEmbedGroups(null, null, null, label)).toEqual([])
  })
})
