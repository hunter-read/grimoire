import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import UserCampaignsList from './UserCampaignsList'
import { campaigns } from '../../api'

vi.mock('../../api', () => ({
  default: {},
  campaigns: { adminListByUser: vi.fn() },
}))

describe('UserCampaignsList', () => {
  beforeEach(() => vi.resetAllMocks())

  it('renders the empty state when the user owns no campaigns', async () => {
    campaigns.adminListByUser.mockResolvedValueOnce([])
    render(<UserCampaignsList userId="u1" />)
    expect(await screen.findByText('No campaigns.')).toBeInTheDocument()
  })

  it('lists campaign names with GM and system badges', async () => {
    campaigns.adminListByUser.mockResolvedValueOnce([
      { id: 'c1', name: 'Lost Mine', is_gm_campaign: true, system_name: 'D&D 5e' },
    ])
    render(<UserCampaignsList userId="u1" />)
    expect(await screen.findByText('Lost Mine')).toBeInTheDocument()
    expect(screen.getByText('GM')).toBeInTheDocument()
    expect(screen.getByText('D&D 5e')).toBeInTheDocument()
  })

  it('shows an error message when loading fails', async () => {
    campaigns.adminListByUser.mockRejectedValueOnce(new Error('boom'))
    render(<UserCampaignsList userId="u1" />)
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('reloads when the userId changes', async () => {
    campaigns.adminListByUser.mockResolvedValue([])
    const { rerender } = render(<UserCampaignsList userId="u1" />)
    await waitFor(() => expect(campaigns.adminListByUser).toHaveBeenCalledWith('u1'))
    rerender(<UserCampaignsList userId="u2" />)
    await waitFor(() => expect(campaigns.adminListByUser).toHaveBeenCalledWith('u2'))
  })
})
