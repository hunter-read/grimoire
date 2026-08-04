import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LuFileText } from 'react-icons/lu'
import {
  CAMPAIGN_ICONS,
  CAMPAIGN_ICON_NAMES,
  CampaignIcon,
  isEmojiIcon,
  searchIconNames,
} from './campaignIcons'

describe('campaign icon catalogue', () => {
  it('resolves every listed name to a component', () => {
    expect(CAMPAIGN_ICON_NAMES.length).toBeGreaterThan(150)
    for (const name of CAMPAIGN_ICON_NAMES) {
      expect(typeof CAMPAIGN_ICONS[name]).toBe('function')
    }
  })

  // The key is persisted in the database, so keys present before the catalogue
  // was expanded must keep resolving or existing pages lose their icons.
  it('keeps the original keys resolvable', () => {
    const legacy = ['user', 'swords', 'shield', 'scroll', 'book', 'map', 'castle', 'dice', 'ring']
    for (const key of legacy) expect(CAMPAIGN_ICONS[key]).toBeTruthy()
  })
})

describe('searchIconNames', () => {
  it('returns everything for an empty query', () => {
    expect(searchIconNames('')).toHaveLength(CAMPAIGN_ICON_NAMES.length)
    expect(searchIconNames('   ')).toHaveLength(CAMPAIGN_ICON_NAMES.length)
  })

  it('matches on the key itself', () => {
    expect(searchIconNames('castle')).toContain('castle')
  })

  it('matches on keywords the key does not contain', () => {
    // "pine" is findable by the concept "tree", which isn't in its key.
    expect(searchIconNames('tree')).toContain('pine')
    // "mask" is findable via "disguise".
    expect(searchIconNames('disguise')).toContain('mask')
  })

  it('is case insensitive', () => {
    expect(searchIconNames('DRAGON'.toLowerCase())).toEqual(searchIconNames('dragon'))
    expect(searchIconNames('Castle')).toContain('castle')
  })

  it('requires every term to match, so extra terms narrow', () => {
    const one = searchIconNames('fire')
    const two = searchIconNames('fire spell')
    expect(two.length).toBeLessThanOrEqual(one.length)
    // A pair that shares no icon yields nothing rather than a union.
    expect(searchIconNames('castle rabbit')).toHaveLength(0)
  })

  it('returns an empty list when nothing matches', () => {
    expect(searchIconNames('zzzznotanicon')).toEqual([])
  })
})

describe('isEmojiIcon', () => {
  it('treats non-ASCII values as emoji', () => {
    expect(isEmojiIcon('🐉')).toBe(true)
    expect(isEmojiIcon('⚔️')).toBe(true)
  })

  it('treats curated ASCII keys and empty values as not emoji', () => {
    expect(isEmojiIcon('swords')).toBe(false)
    expect(isEmojiIcon('')).toBe(false)
    expect(isEmojiIcon(null)).toBe(false)
    expect(isEmojiIcon(undefined)).toBe(false)
  })
})

describe('CampaignIcon', () => {
  it('renders an emoji value as text', () => {
    render(<CampaignIcon name="🐉" size={16} />)
    expect(screen.getByText('🐉')).toBeInTheDocument()
  })

  it('renders a curated key as an svg', () => {
    const { container } = render(<CampaignIcon name="swords" size={16} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('falls back when the name is unset or unknown', () => {
    const { container } = render(<CampaignIcon name="" fallback={LuFileText} size={16} />)
    expect(container.querySelector('svg')).toBeTruthy()

    const unknown = render(<CampaignIcon name="not-a-real-icon" fallback={LuFileText} size={16} />)
    expect(unknown.container.querySelector('svg')).toBeTruthy()
  })

  it('renders nothing when unset with no fallback', () => {
    const { container } = render(<CampaignIcon name="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('applies a style override to both emoji and svg forms', () => {
    render(<CampaignIcon name="🐉" size={16} style={{ color: 'rgb(1, 2, 3)' }} />)
    expect(screen.getByText('🐉').style.color).toBe('rgb(1, 2, 3)')
  })
})
