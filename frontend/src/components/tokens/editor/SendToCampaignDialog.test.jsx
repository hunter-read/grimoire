import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../api', () => ({
  campaigns: { list: vi.fn(), get: vi.fn(), listCategories: vi.fn() },
}))

import { campaigns } from '../../../api'
import SendToCampaignDialog from './SendToCampaignDialog'

const ME = 'user-me'

/** One campaign detail payload, with a members list. */
const campaign = (over = {}) => ({
  id: 'c1',
  name: 'Curse of Strahd',
  owner_id: 'someone-else',
  members: [],
  ...over,
})

const member = (over = {}) => ({
  id: 'm1',
  user_id: ME,
  character_name: 'Ireena',
  ...over,
})

const setup = (props = {}) =>
  render(
    <SendToCampaignDialog
      userId={ME}
      onClose={vi.fn()}
      onChooseMember={vi.fn()}
      onChooseCampaign={vi.fn()}
      {...props}
    />
  )

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.listCategories.mockResolvedValue([])
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
    const onChooseMember = vi.fn()
    campaigns.list.mockResolvedValue([{ id: 'c1' }])
    campaigns.get.mockResolvedValue(campaign({ members: [member()] }))

    setup({ onChooseMember })
    await userEvent.click(await screen.findByRole('button', { name: /Ireena/ }))

    expect(onChooseMember).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'c1', memberId: 'm1' })
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

    const onChooseMember = vi.fn()
    setup({ onChooseMember })

    await userEvent.click(await screen.findByRole('button', { name: /Curse of Strahd/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Set as a character token/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Rahadin/ }))

    expect(onChooseMember).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'c1', memberId: 'm1' })
    )
  })

  it('offers no character route in a GM’d campaign with no members', async () => {
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
