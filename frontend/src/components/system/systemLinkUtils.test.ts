import { describe, it, expect } from 'vitest'
import {
  collectSystemLinks,
  splitSystemLinks,
  linkText,
  MAX_VISIBLE_LINKS,
} from './systemLinkUtils'

const b = (n) => ({ label: `B${n}`, url: `https://b${n}.example`, builder: true })
const g = (n) => ({ label: `G${n}`, url: `https://g${n}.example`, builder: false })
const labels = (list) => list.map((l) => l.label)

describe('collectSystemLinks', () => {
  it('lists builders first, then links, tagged by kind and without blank URLs', () => {
    const links = collectSystemLinks({
      character_builder_urls: [{ label: 'DS', url: 'https://ds' }],
      urls: [
        { label: 'Site', url: 'https://site' },
        { label: 'Empty', url: '' },
      ],
    })
    expect(links).toEqual([
      { label: 'DS', url: 'https://ds', builder: true },
      { label: 'Site', url: 'https://site', builder: false },
    ])
  })

  it('falls back to the legacy single character_builder_url', () => {
    expect(collectSystemLinks({ character_builder_url: 'https://old' })).toEqual([
      { label: '', url: 'https://old', builder: true },
    ])
  })

  it('prefers the list over the legacy field and handles no links', () => {
    expect(
      collectSystemLinks({
        character_builder_urls: [{ label: 'New', url: 'https://new' }],
        character_builder_url: 'https://old',
      }).map((l) => l.url)
    ).toEqual(['https://new'])
    expect(collectSystemLinks({})).toEqual([])
  })
})

describe('splitSystemLinks', () => {
  it('shows everything when it fits', () => {
    const links = [b(1), g(1), g(2)]
    expect(splitSystemLinks(links)).toEqual({ visible: links, overflow: [] })
  })

  it('keeps one of each kind visible when both are present', () => {
    const { visible, overflow } = splitSystemLinks([b(1), b(2), b(3), b(4), b(5), g(1), g(2)])
    expect(labels(visible)).toEqual(['B1', 'B2', 'G1'])
    expect(labels(overflow)).toEqual(['B3', 'B4', 'B5', 'G2'])
  })

  it('keeps a lone builder visible behind many links', () => {
    const { visible, overflow } = splitSystemLinks([b(1), g(1), g(2), g(3), g(4), g(5)])
    expect(labels(visible)).toEqual(['B1', 'G1', 'G2'])
    expect(labels(overflow)).toEqual(['G3', 'G4', 'G5'])
  })

  it('handles five of each', () => {
    const links = [1, 2, 3, 4, 5].map(b).concat([1, 2, 3, 4, 5].map(g))
    const { visible, overflow } = splitSystemLinks(links)
    expect(visible).toHaveLength(MAX_VISIBLE_LINKS)
    expect(visible.some((l) => l.builder)).toBe(true)
    expect(visible.some((l) => !l.builder)).toBe(true)
    expect(overflow).toHaveLength(7)
  })

  it('fills from a single kind when only one is present', () => {
    const { visible, overflow } = splitSystemLinks([g(1), g(2), g(3), g(4)])
    expect(labels(visible)).toEqual(['G1', 'G2', 'G3'])
    expect(labels(overflow)).toEqual(['G4'])
  })

  it('still shows one of each kind when the limit is smaller than two', () => {
    const { visible } = splitSystemLinks([b(1), b(2), g(1)], 1)
    expect(labels(visible)).toEqual(['B1', 'G1'])
  })
})

describe('linkText', () => {
  it('uses the label, then the hostname, then the fallback', () => {
    expect(linkText({ label: 'Mine', url: 'https://x.com' }, 'Link')).toBe('Mine')
    expect(linkText({ label: '', url: 'https://www.daggerstack.com/a' }, 'Link')).toBe(
      'daggerstack.com'
    )
    expect(linkText({ label: '', url: 'not a url' }, 'Link')).toBe('Link')
  })
})
