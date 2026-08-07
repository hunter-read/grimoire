import { describe, it, expect } from 'vitest'
import {
  TitleTrie,
  buildTarget,
  buildTitleTrie,
  findHeading,
  isEmbed,
  parseTarget,
  resolvePage,
  slugify,
} from './wikiLinkTarget'

// These parse rules must match backend/routers/campaigns/wikilinks.py exactly —
// the backend has the mirror of this suite in test_campaign_wiki_links.py.
describe('parseTarget', () => {
  it('parses a plain title', () => {
    expect(parseTarget('Ancient Ruins')).toEqual({
      title: 'Ancient Ruins',
      pageId: null,
      heading: null,
    })
  })

  it('parses an :id- suffix', () => {
    expect(parseTarget('Ancient Ruins:id-abc123')).toEqual({
      title: 'Ancient Ruins',
      pageId: 'abc123',
      heading: null,
    })
  })

  it('parses a :#Heading suffix', () => {
    expect(parseTarget('Ruins:#Loot')).toEqual({ title: 'Ruins', pageId: null, heading: 'Loot' })
  })

  it('parses id and heading together', () => {
    expect(parseTarget('Ruins:id-abc:#Loot')).toEqual({
      title: 'Ruins',
      pageId: 'abc',
      heading: 'Loot',
    })
  })

  it('leaves an ordinary colon in a title alone', () => {
    expect(parseTarget('Ancient Ruins: The Depths')).toEqual({
      title: 'Ancient Ruins: The Depths',
      pageId: null,
      heading: null,
    })
  })

  it('handles a colon-bearing title alongside real suffixes', () => {
    expect(parseTarget('Ruins: The Depths:id-x1:#Loot')).toEqual({
      title: 'Ruins: The Depths',
      pageId: 'x1',
      heading: 'Loot',
    })
  })

  it('needs no escape for a heading that starts with #', () => {
    // Markdown "# # of coin" is a heading whose text is "# of coin".
    expect(parseTarget('Prices:## of coin').heading).toBe('# of coin')
  })

  it('does not treat mid-title ":id-" text as a suffix', () => {
    expect(parseTarget('Rules:id-42 and more').pageId).toBe(null)
  })

  it('round-trips through buildTarget', () => {
    const cases = [
      ['Ruins', null, null],
      ['Ruins', 'abc', null],
      ['Ruins', null, 'Loot'],
      ['Ruins', 'abc', 'Loot'],
      ['Ruins: Deep', 'abc', '# of coin'],
    ]
    for (const [title, id, heading] of cases) {
      expect(parseTarget(buildTarget(title, id, heading))).toEqual({
        title,
        pageId: id,
        heading,
      })
    }
  })
})

describe('isEmbed', () => {
  it('recognises Grimoire content embeds', () => {
    expect(isEmbed('book:abc:5')).toBe(true)
    expect(isEmbed('MAP:xyz')).toBe(true)
    expect(isEmbed('The Bookshelf')).toBe(false)
  })
})

describe('slugify', () => {
  it('matches the backend normalisation', () => {
    expect(slugify('Ancient Ruins')).toBe('ancient-ruins')
    expect(slugify('ancient ruins')).toBe('ancient-ruins')
    expect(slugify('Ancient  Ruins!')).toBe('ancient-ruins')
    expect(slugify('Ancient-Ruins')).toBe('ancient-ruins')
  })

  it('keeps non-ASCII letters (issue #252)', () => {
    expect(slugify('Breitfuß')).toBe('breitfuß')
    expect(slugify('Zürich Straße')).toBe('zürich-straße')
  })
})

describe('resolvePage', () => {
  const pages = [
    { id: 'p1', title: 'Ancient Ruins', slug: 'ancient-ruins' },
    { id: 'p2', title: 'ancient ruins', slug: 'ancient-ruins-2' },
  ]

  it('resolves an unpinned link by slug', () => {
    expect(resolvePage(parseTarget('Ancient Ruins'), pages).id).toBe('p1')
  })

  it('resolves a pinned link by id, reaching the -2 page', () => {
    expect(resolvePage(parseTarget('Ancient Ruins:id-p2'), pages).id).toBe('p2')
  })

  it('follows the id even when the title has gone stale', () => {
    expect(resolvePage(parseTarget('Whatever Old Name:id-p1'), pages).id).toBe('p1')
  })

  it('returns null for a stale pin rather than falling back to the title', () => {
    // Falling back would silently re-point the link at a different page.
    expect(resolvePage(parseTarget('Ancient Ruins:id-gone'), pages)).toBe(null)
  })
})

describe('findHeading', () => {
  it('prefers H1 over H2', () => {
    const headings = [
      { text: 'Loot', level: 2 },
      { text: 'Loot', level: 1 },
    ]
    expect(findHeading(headings, 'Loot').level).toBe(1)
  })

  it('takes the first of equal level', () => {
    const headings = [
      { text: 'Other', level: 1 },
      { text: 'Loot', level: 1 },
      { text: 'Loot', level: 1 },
    ]
    expect(findHeading(headings, 'loot')).toBe(headings[1])
  })

  it('matches case- and whitespace-insensitively', () => {
    expect(findHeading([{ text: 'The  Loot', level: 2 }], 'the loot')).toBeTruthy()
  })

  it('returns null when absent', () => {
    expect(findHeading([{ text: 'Something', level: 1 }], 'Nothing')).toBe(null)
  })
})

describe('TitleTrie', () => {
  it('matches on a leading prefix', () => {
    const trie = new TitleTrie()
    trie.insert('Boblin the Goblin', { key: 'a', label: 'Boblin the Goblin' })
    trie.insert('Castle Ruins', { key: 'b', label: 'Castle Ruins' })
    expect(trie.search('bob').map((e) => e.key)).toEqual(['a'])
  })

  it('matches on any word start, not just the first', () => {
    const trie = new TitleTrie()
    trie.insert('Boblin the Goblin', { key: 'a', label: 'Boblin the Goblin' })
    trie.insert('Goblin Camp', { key: 'b', label: 'Goblin Camp' })
    expect(
      trie
        .search('gob')
        .map((e) => e.key)
        .sort()
    ).toEqual(['a', 'b'])
  })

  it('is case-insensitive', () => {
    const trie = new TitleTrie()
    trie.insert('Boblin', { key: 'a', label: 'Boblin' })
    expect(trie.search('BOB').map((e) => e.key)).toEqual(['a'])
  })

  it('returns everything for an empty query', () => {
    const trie = new TitleTrie()
    trie.insert('One', { key: 'a', label: 'One' })
    trie.insert('Two', { key: 'b', label: 'Two' })
    expect(trie.search('').length).toBe(2)
  })

  it('returns nothing for a prefix that matches no entry', () => {
    const trie = new TitleTrie()
    trie.insert('Boblin', { key: 'a', label: 'Boblin' })
    expect(trie.search('zzz')).toEqual([])
  })

  it('de-duplicates an entry indexed under several word starts', () => {
    const trie = new TitleTrie()
    // "goblin" appears twice, so the entry is indexed twice under "gob".
    trie.insert('Goblin the Goblin', { key: 'a', label: 'Goblin the Goblin' })
    expect(trie.search('gob').length).toBe(1)
  })

  it('honours the result limit', () => {
    const trie = new TitleTrie()
    for (let i = 0; i < 20; i++) trie.insert(`Page ${i}`, { key: `k${i}`, label: `Page ${i}` })
    expect(trie.search('page', 5).length).toBe(5)
  })
})

describe('buildTitleTrie', () => {
  const pages = [
    { id: 'p1', title: 'Bestiary', ambiguous: false, headings: [{ text: 'Goblins', level: 1 }] },
    {
      id: 'p2',
      title: 'Ancient Ruins',
      ambiguous: true,
      parent_title: 'Northlands',
      headings: [],
    },
    {
      id: 'p3',
      title: 'ancient ruins',
      ambiguous: true,
      parent_title: 'Southmarch',
      headings: [],
    },
  ]

  it('emits a bare title for an unambiguous page', () => {
    const trie = buildTitleTrie(pages)
    const match = trie.search('bestiary').find((m) => m.key === 'page:p1')
    expect(match.target).toBe('Bestiary')
  })

  it('appends :id- only when the title is ambiguous', () => {
    const trie = buildTitleTrie(pages)
    const matches = trie.search('ancient')
    expect(matches.find((m) => m.key === 'page:p2').target).toBe('Ancient Ruins:id-p2')
    expect(matches.find((m) => m.key === 'page:p3').target).toBe('ancient ruins:id-p3')
  })

  it('offers a heading completion that inserts :#Heading', () => {
    const trie = buildTitleTrie(pages)
    const heading = trie.search('goblins').find((m) => m.detail === 'H1')
    expect(heading.target).toBe('Bestiary:#Goblins')
    expect(heading.label).toBe('Bestiary › Goblins')
  })

  it('carries the id into a heading target when the page is ambiguous', () => {
    const trie = buildTitleTrie([
      { id: 'p9', title: 'Dupe', ambiguous: true, headings: [{ text: 'Loot', level: 2 }] },
    ])
    expect(trie.search('loot')[0].target).toBe('Dupe:id-p9:#Loot')
  })

  it('qualifies an ambiguous title with its immediate parent', () => {
    const trie = buildTitleTrie(pages)
    const matches = trie.search('ancient')
    expect(matches.find((m) => m.key === 'page:p2').label).toBe('Ancient Ruins (Northlands)')
    expect(matches.find((m) => m.key === 'page:p3').label).toBe('ancient ruins (Southmarch)')
  })

  it('leaves an unambiguous title unqualified even when it has a parent', () => {
    const trie = buildTitleTrie([
      { id: 'p1', title: 'Bestiary', ambiguous: false, parent_title: 'Lore', headings: [] },
    ])
    expect(trie.search('bestiary')[0].label).toBe('Bestiary')
  })

  it('omits the qualifier for a top-level ambiguous page', () => {
    const trie = buildTitleTrie([
      { id: 'p1', title: 'Dupe', ambiguous: true, parent_title: null, headings: [] },
    ])
    expect(trie.search('dupe')[0].label).toBe('Dupe')
  })

  it('qualifies heading rows of an ambiguous page too', () => {
    const trie = buildTitleTrie([
      {
        id: 'p9',
        title: 'Dupe',
        ambiguous: true,
        parent_title: 'Northlands',
        headings: [{ text: 'Loot', level: 2 }],
      },
    ])
    expect(trie.search('loot')[0].label).toBe('Dupe (Northlands) › Loot')
  })

  it('does not match on the parent name, only the title', () => {
    // The qualifier is display-only; typing the parent shouldn't surface the child.
    const trie = buildTitleTrie(pages)
    expect(trie.search('northlands')).toEqual([])
  })
})
