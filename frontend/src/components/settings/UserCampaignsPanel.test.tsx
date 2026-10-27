import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UserCampaignsPanel from './UserCampaignsPanel'
import { campaigns } from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../../api', () => ({
  default: {},
  campaigns: { adminListByUser: vi.fn() },
}))

const toggle = () => screen.getByRole('button', { name: 'users.campaigns.toggleLabel' })

beforeEach(() => vi.resetAllMocks())

describe('UserCampaignsPanel', () => {
  it('starts collapsed and loads nothing until opened', () => {
    render(<UserCampaignsPanel userId="u1" />)
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(campaigns.adminListByUser).not.toHaveBeenCalled()
  })

  it('loads and lists the campaigns with their badges when opened', async () => {
    vi.mocked(campaigns.adminListByUser).mockResolvedValue([
      {
        id: 'c1',
        name: 'Lost Mine',
        is_gm_campaign: true,
        system_name: 'D&D 5e',
        description: 'A starter adventure',
      },
      { id: 'c2', name: 'Side Quest' },
    ])
    render(<UserCampaignsPanel userId="u1" />)
    fireEvent.click(toggle())

    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Lost Mine')).toBeInTheDocument()
    expect(campaigns.adminListByUser).toHaveBeenCalledWith('u1')
    expect(screen.getByText('Side Quest')).toBeInTheDocument()
    expect(screen.getByText('GM')).toBeInTheDocument()
    expect(screen.getByText('D&D 5e')).toBeInTheDocument()
    expect(screen.getByText('A starter adventure')).toBeInTheDocument()
  })

  it('shows the empty state when the user has no campaigns', async () => {
    vi.mocked(campaigns.adminListByUser).mockResolvedValue([])
    render(<UserCampaignsPanel userId="u1" />)
    fireEvent.click(toggle())
    expect(await screen.findByText('users.campaigns.none')).toBeInTheDocument()
  })

  it("shows the server's message when loading fails", async () => {
    vi.mocked(campaigns.adminListByUser).mockRejectedValue(new Error('boom'))
    render(<UserCampaignsPanel userId="u1" />)
    fireEvent.click(toggle())
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('falls back to a generic message when the failure has none', async () => {
    vi.mocked(campaigns.adminListByUser).mockRejectedValue(new Error(''))
    render(<UserCampaignsPanel userId="u1" />)
    fireEvent.click(toggle())
    expect(await screen.findByText('users.campaigns.loadFailed')).toBeInTheDocument()
  })

  it('loads once, keeping the list across collapsing and reopening', async () => {
    vi.mocked(campaigns.adminListByUser).mockResolvedValue([{ id: 'c1', name: 'Lost Mine' }])
    render(<UserCampaignsPanel userId="u1" />)
    fireEvent.click(toggle())
    await screen.findByText('Lost Mine')

    fireEvent.click(toggle())
    expect(screen.queryByText('Lost Mine')).toBeNull()
    fireEvent.click(toggle())
    expect(screen.getByText('Lost Mine')).toBeInTheDocument()
    expect(campaigns.adminListByUser).toHaveBeenCalledTimes(1)
  })
})
