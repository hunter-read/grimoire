import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../api', () => ({
  campaigns: { list: vi.fn(), get: vi.fn(), listCategories: vi.fn() },
  characters: { list: vi.fn() },
}))

import { campaigns as campaignsApi, characters as charactersApi } from '../../../api'
import SendToCampaignDialog from './SendToCampaignDialog'

// The fixtures below are partial campaign payloads, so the mocks are reached
// untyped rather than through the full response types.
const campaigns = campaignsApi as unknown as { list: Mock; get: Mock; listCategories: Mock }
const characters = charactersApi as unknown as { list: Mock }

const ME = 'user-me'

/** One campaign detail payload, with a members list. */
const campaign = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Curse of Strahd',
  owner_id: 'someone-else',
  members: [],
  ...over,
})

const member = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  user_id: ME,
  character_name: 'Ireena',
  ...over,
})

/** One character sheet from the `/characters` list, placed in campaign c1. */
const sheet = (over: Record<string, unknown> = {}) => ({
  id: 'ch1',
  name: 'Strahd',
  campaign_id: 'c1',
  editable: true,
  ...over,
})

const setup = (props: Record<string, unknown> = {}) =>
  render(
    <SendToCampaignDialog
      userId={ME}
      onClose={vi.fn()}
      onChooseCharacter={vi.fn()}
      onChooseCampaign={vi.fn()}
      {...props}
    />
  )

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.listCategories.mockResolvedValue([])
  characters.list.mockResolvedValue({ characters: [] })
})

describe('SendToCampaignDialog', () => {
  it('lists the viewer’s own character for a game they play in', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ members: [member()] }))

    setup()

    expect(await screen.findByText('Send to a character')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ireena/ })).toBeInTheDocument()
  })

  it('reports the chosen membership', async () => {
    const onChooseCharacter = vi.fn()
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ members: [member()] }))

    setup({ onChooseCharacter })
    await userEvent.click(await screen.findByRole('button', { name: /Ireena/ }))

    expect(onChooseCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'member', campaignId: 'c1', id: 'm1' })
    )
  })

  it('hides other players’ memberships in a campaign the viewer does not own', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(
      campaign({
        members: [
          member(),
          member({ id: 'm2', user_id: 'someone-else', character_name: 'Rahadin' }),
        ],
      })
    )

    setup()

    expect(await screen.findByRole('button', { name: /Ireena/ })).toBeInTheDocument()
    // Not their row to edit — the server would refuse it, so it is not offered.
    expect(screen.queryByRole('button', { name: /Rahadin/ })).not.toBeInTheDocument()
  })

  it('does not flood step one with the characters from a campaign it GMs', async () => {
    // The whole point of the restructure: four GM'd campaigns must not put
    // twenty characters in front of the four campaign rows.
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(
      campaign({
        owner_id: ME,
        members: [member({ user_id: 'player-2', character_name: 'Rahadin' })],
      })
    )

    setup()

    expect(await screen.findByRole('button', { name: /Curse of Strahd/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rahadin/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Send to a character')).not.toBeInTheDocument()
  })

  it('reaches a GM’d campaign’s characters through the campaign, then the character', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(
      campaign({
        owner_id: ME,
        members: [member({ user_id: 'player-2', character_name: 'Rahadin' })],
      })
    )

    const onChooseCharacter = vi.fn()
    setup({ onChooseCharacter })

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Set as a character token/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Rahadin/ }))

    expect(onChooseCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'member', campaignId: 'c1', id: 'm1' })
    )
  })

  it('offers a GM’d campaign’s character sheets when it has no players (#949)', async () => {
    // A GM-only campaign: no memberships, just a sheet the GM made in it.
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ owner_id: ME, members: [] }))
    characters.list.mockResolvedValue({ characters: [sheet()] })

    const onChooseCharacter = vi.fn()
    setup({ onChooseCharacter })

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))
    const route = await screen.findByRole('button', { name: /Set as a character token/ })
    expect(route).toBeEnabled()
    await userEvent.click(route)
    await userEvent.click(await screen.findByRole('button', { name: /Strahd.*Sheet portrait/ }))

    expect(onChooseCharacter).toHaveBeenCalledWith({
      kind: 'sheet',
      campaignId: 'c1',
      campaignName: 'Curse of Strahd',
      id: 'ch1',
      name: 'Strahd',
    })
  })

  it('lists both a GM’d campaign’s memberships and its sheets', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(
      campaign({
        owner_id: ME,
        members: [member({ user_id: 'player-2', character_name: 'Rahadin' })],
      })
    )
    characters.list.mockResolvedValue({ characters: [sheet()] })

    setup()

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Set as a character token/ }))

    expect(await screen.findByRole('button', { name: /Rahadin.*Party token/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Strahd.*Sheet portrait/ })).toBeInTheDocument()
  })

  it('leaves out sheets the viewer may not edit, or that sit in no campaign', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ owner_id: ME, members: [] }))
    characters.list.mockResolvedValue({
      characters: [
        // A player's sheet the GM was not let in to edit: the server would 404.
        sheet({ id: 'ch2', name: 'Ireena', editable: false }),
        sheet({ id: 'ch3', name: 'Ezmerelda', campaign_id: null }),
      ],
    })

    setup()

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))
    expect(await screen.findByRole('button', { name: /Set as a character token/ })).toBeDisabled()
  })

  it('offers a player their own sheet in a game they play in', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ members: [member()] }))
    characters.list.mockResolvedValue({ characters: [sheet({ name: '' })] })

    const onChooseCharacter = vi.fn()
    setup({ onChooseCharacter })

    // Both of the player's pictures are offered, each saying which it replaces.
    expect(await screen.findByRole('button', { name: /Ireena.*Party token/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Unnamed character/ }))

    expect(onChooseCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sheet', id: 'ch1', name: 'Unnamed character' })
    )
  })

  it('still offers memberships and campaigns when the sheet list fails', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ members: [member()] }))
    characters.list.mockRejectedValue(new Error('sheets down'))

    setup()

    expect(await screen.findByRole('button', { name: /Ireena/ })).toBeInTheDocument()
    expect(screen.queryByText('sheets down')).not.toBeInTheDocument()
  })

  it('offers no character route in a GM’d campaign with no characters', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ owner_id: ME, members: [] }))

    setup()

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))
    expect(await screen.findByRole('button', { name: /Set as a character token/ })).toBeDisabled()
  })

  it('lists a campaign the viewer GMs under its own heading', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ owner_id: ME }))

    setup()

    expect(await screen.findByText('Send to a campaign you GM')).toBeInTheDocument()
  })

  it('withholds the GM section from a non-GM', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ members: [member()] }))

    setup()

    await screen.findByText('Send to a character')
    expect(screen.queryByText('Send to a campaign you GM')).not.toBeInTheDocument()
  })

  it('says so when the viewer has no campaign to send to', async () => {
    campaigns.list.mockResolvedValue([])

    setup()

    expect(await screen.findByText('You have no campaigns to send this to.')).toBeInTheDocument()
  })

  it('asks a GM for a category, defaulting to the built-in Tokens group', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ owner_id: ME }))
    campaigns.listCategories.mockResolvedValue([{ id: 'cat1', name: 'Villains' }])

    const onChooseCampaign = vi.fn()
    setup({ onChooseCampaign })

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))

    expect(await screen.findByRole('button', { name: /Villains/ })).toBeInTheDocument()
    // No category id: the resource falls into the built-in Tokens group.
    await userEvent.click(screen.getByRole('button', { name: /Tokens/ }))
    expect(onChooseCampaign).toHaveBeenCalledWith({ campaignId: 'c1', categoryId: null })
  })

  it('reports the chosen category', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ owner_id: ME }))
    campaigns.listCategories.mockResolvedValue([{ id: 'cat1', name: 'Villains' }])

    const onChooseCampaign = vi.fn()
    setup({ onChooseCampaign })

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Villains/ }))

    expect(onChooseCampaign).toHaveBeenCalledWith({ campaignId: 'c1', categoryId: 'cat1' })
  })

  it('steps back from the character list to the category step', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(
      campaign({ owner_id: ME, members: [member({ character_name: 'Rahadin' })] })
    )

    setup()

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Set as a character token/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    // Back to the category step, not all the way out to step one.
    expect(await screen.findByRole('button', { name: /Tokens/ })).toBeInTheDocument()
  })

  it('goes back from the category step to the destination list', async () => {
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ owner_id: ME }))

    setup()

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }))

    expect(screen.getByText('Send to a campaign you GM')).toBeInTheDocument()
  })

  it('survives a campaign listing that fails', async () => {
    campaigns.list.mockRejectedValue(new Error('nope'))

    setup()

    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument())
  })

  it('reads the bare array `/campaigns` actually returns', async () => {
    // Regression: the loader used `list?.campaigns || []`, which is always empty
    // against the real endpoint — a GM of four campaigns saw zero options.
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ owner_id: ME }))

    setup()

    expect(await screen.findByRole('button', { name: /Curse of Strahd/ })).toBeInTheDocument()
  })

  it('still copes with a wrapped payload', async () => {
    campaigns.list.mockResolvedValue({ campaigns: [{ id: 'c1' }] })
    campaigns.get.mockResolvedValue(campaign({ owner_id: ME }))

    setup()

    expect(await screen.findByRole('button', { name: /Curse of Strahd/ })).toBeInTheDocument()
  })
})
