import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CampaignCharacters from './CampaignCharacters'

const mockList = vi.fn()
const mockUpdate = vi.fn()
vi.mock('../../api', () => ({
  characters: {
    list: (...a: unknown[]) => mockList(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    portraitUrl: (id: string) => `/portrait/${id}`,
  },
  campaigns: { ownerTokenUrl: (id: string) => `/owner-token/${id}` },
}))

type Row = Record<string, unknown>

const row = (overrides: Row): Row => ({
  schema_ref: 'demo',
  schema_name: 'Demo Sheet',
  status: 'active',
  owned: false,
  campaign_id: 'camp',
  ...overrides,
})

// The GM keeps an NPC; Bob plays Hero now, after losing three before them.
const ROSTER = [
  row({ id: 'npc', name: 'Innkeeper', user_id: 'gm', owner_name: 'Dana', owned: true }),
  row({ id: 'hero', name: 'Hero', user_id: 'bob', owner_name: 'Bob' }),
  row({ id: 'd1', name: 'Fallen One', user_id: 'bob', owner_name: 'Bob', status: 'dead' }),
  row({ id: 'd2', name: 'Fallen Two', user_id: 'bob', owner_name: 'Bob', status: 'dead' }),
  row({ id: 'r1', name: 'Old Timer', user_id: 'bob', owner_name: 'Bob', status: 'retired' }),
]

const renderCard = (props: Partial<Parameters<typeof CampaignCharacters>[0]> = {}) =>
  render(
    <MemoryRouter>
      <CampaignCharacters campaignId="camp" ownerId="gm" viewerId="gm" canAdd {...props} />
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockImplementation((params?: Row) =>
    Promise.resolve({ characters: params?.campaign_id === 'camp' ? ROSTER : [] })
  )
})

describe('CampaignCharacters', () => {
  it('asks only for this campaign’s characters', async () => {
    renderCard()
    await screen.findByText('Innkeeper')
    expect(mockList).toHaveBeenCalledWith({ campaign_id: 'camp' })
  })

  it('groups characters under their player, the GM first', async () => {
    renderCard()
    const gm = await screen.findByRole('region', { name: 'Dana' })
    expect(within(gm).getByText('GM')).toBeInTheDocument()
    expect(within(gm).getByRole('link', { name: /Innkeeper/ })).toHaveAttribute(
      'href',
      '/characters/npc'
    )
    const sections = screen.getAllByRole('region')
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Dana', 'Bob'])
  })

  it('shows a player’s current character and folds away the past ones', async () => {
    const user = userEvent.setup()
    renderCard()
    const bob = await screen.findByRole('region', { name: 'Bob' })
    expect(within(bob).getByText('Hero')).toBeInTheDocument()
    expect(within(bob).queryByText('Fallen One')).not.toBeInTheDocument()

    const toggle = within(bob).getByRole('button', { name: '3 past characters' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(bob).getByText('Fallen One')).toBeInTheDocument()
    expect(within(bob).getByText('Old Timer')).toBeInTheDocument()
    expect(within(bob).getByText('Retired')).toBeInTheDocument()

    await user.click(toggle)
    expect(within(bob).queryByText('Fallen One')).not.toBeInTheDocument()
  })

  it('says when a player has no character in play, only past ones', async () => {
    mockList.mockResolvedValue({
      characters: [
        row({ id: 'd1', name: 'Gone', user_id: 'bob', owner_name: 'Bob', status: 'dead' }),
      ],
    })
    renderCard()
    const bob = await screen.findByRole('region', { name: 'Bob' })
    expect(within(bob).getByText('No active character')).toBeInTheDocument()
    expect(within(bob).getByRole('button', { name: '1 past character' })).toBeInTheDocument()
  })

  it('marks the viewer’s own group', async () => {
    renderCard({ viewerId: 'bob' })
    const bob = await screen.findByRole('region', { name: 'Bob' })
    expect(within(bob).getByText('(you)')).toBeInTheDocument()
  })

  it('shows an empty state to someone who can add a character', async () => {
    mockList.mockResolvedValue({ characters: [] })
    renderCard()
    expect(await screen.findByText('No characters in this campaign yet.')).toBeInTheDocument()
  })

  it('renders nothing for someone with nothing to see and nothing to add', async () => {
    mockList.mockResolvedValue({ characters: [] })
    const { container } = renderCard({ canAdd: false })
    await vi.waitFor(() => expect(mockList).toHaveBeenCalled())
    await Promise.resolve()
    expect(container).toBeEmptyDOMElement()
  })

  it('reports a failed load', async () => {
    mockList.mockRejectedValue(new Error('Nope'))
    renderCard({ canAdd: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
  })

  it('hides the add button from someone who cannot add', async () => {
    renderCard({ canAdd: false })
    await screen.findByText('Innkeeper')
    expect(screen.queryByRole('button', { name: /add character/i })).not.toBeInTheDocument()
  })

  it('brings one of the viewer’s own characters to the table', async () => {
    const user = userEvent.setup()
    const elsewhere = row({
      id: 'wand',
      name: 'Wanderer',
      owned: true,
      campaign_id: 'other',
      campaign_name: 'Other Game',
    })
    let attached = false
    mockList.mockImplementation((params?: Row) => {
      if (params?.campaign_id === 'camp') {
        return Promise.resolve({ characters: attached ? [...ROSTER, elsewhere] : ROSTER })
      }
      // Everything readable: the viewer's own, plus party sheets they cannot move.
      return Promise.resolve({ characters: [...ROSTER, elsewhere] })
    })
    mockUpdate.mockImplementation(() => {
      attached = true
      return Promise.resolve({})
    })
    renderCard()
    await user.click(await screen.findByRole('button', { name: /add character/i }))

    const picker = await screen.findByRole('list', { name: 'Bring one of your characters' })
    // Already here, or someone else's: not offered.
    expect(within(picker).queryByText('Innkeeper')).not.toBeInTheDocument()
    expect(within(picker).queryByText('Hero')).not.toBeInTheDocument()
    expect(within(picker).getByText('Demo Sheet · Other Game')).toBeInTheDocument()

    await user.click(within(picker).getByRole('button', { name: /Wanderer/ }))
    expect(mockUpdate).toHaveBeenCalledWith('wand', { campaign_id: 'camp' })
    expect(await screen.findByRole('link', { name: /Wanderer/ })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Bring one of your characters' })).toBeNull()
  })
})

describe('CampaignCharacters owner token', () => {
  it('shows a personal campaign’s owner token in the card', async () => {
    renderCard({ ownerToken: { name: 'Dana', hasToken: true, canEdit: true } })
    await screen.findByText('Innkeeper')
    expect(screen.getByText('Your token')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Download Dana's token" })).toHaveAttribute(
      'href',
      '/owner-token/camp'
    )
  })

  it('offers the owner a token to make before they have one', async () => {
    renderCard({ ownerToken: { name: 'Dana', hasToken: false, canEdit: true } })
    expect(await screen.findByRole('button', { name: 'Make a token for Dana' })).toBeInTheDocument()
  })

  it('still shows the token with no characters and nothing to add', async () => {
    mockList.mockResolvedValue({ characters: [] })
    renderCard({ canAdd: false, ownerToken: { name: 'Dana', hasToken: true, canEdit: false } })
    expect(await screen.findByRole('link', { name: "Download Dana's token" })).toBeInTheDocument()
  })

  it('shows no token slot without an owner token', async () => {
    renderCard()
    await screen.findByText('Innkeeper')
    expect(screen.queryByText('Your token')).not.toBeInTheDocument()
  })
})
