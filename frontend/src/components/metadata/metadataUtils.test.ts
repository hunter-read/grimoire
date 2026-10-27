import { describe, it, expect } from 'vitest'
import { cleanLinks, linksForEditing, buildGenreTree } from './metadataUtils'

describe('cleanLinks', () => {
  it('drops rows with neither label nor url', () => {
    expect(
      cleanLinks([
        { label: '', url: '' },
        { label: 'X', url: '' },
        { label: '', url: 'http://y' },
      ])
    ).toEqual([
      { label: 'X', url: '' },
      { label: '', url: 'http://y' },
    ])
  })

  it('handles null input', () => {
    expect(cleanLinks(null)).toEqual([])
  })
})

describe('linksForEditing', () => {
  it('returns a blank row when empty', () => {
    expect(linksForEditing([])).toEqual([{ label: '', url: '' }])
    expect(linksForEditing(null)).toEqual([{ label: '', url: '' }])
  })

  it('passes through existing links', () => {
    const links = [{ label: 'a', url: 'b' }]
    expect(linksForEditing(links)).toBe(links)
  })
})

describe('buildGenreTree', () => {
  const genres = [
    { id: 'sci', name: 'Science Fiction', parent_id: null, sort_order: 2 },
    { id: 'cyber', name: 'Cyberpunk', parent_id: 'sci', sort_order: 1 },
    { id: 'fan', name: 'Fantasy', parent_id: null, sort_order: 1 },
  ]

  it('orders parents by sort_order with children nested below', () => {
    const tree = buildGenreTree(genres)
    const names = tree.map((g) => g.name)
    expect(names).toEqual(['Fantasy', 'Science Fiction', 'Cyberpunk'])
  })

  it('assigns depth by nesting level', () => {
    const tree = buildGenreTree(genres)
    const cyber = tree.find((g) => g.name === 'Cyberpunk')
    expect(cyber.depth).toBe(1)
    expect(tree.find((g) => g.name === 'Fantasy').depth).toBe(0)
  })

  it('handles an empty list', () => {
    expect(buildGenreTree([])).toEqual([])
  })
})
