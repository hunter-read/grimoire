import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CampaignsView from './CampaignsView'

vi.mock('../api', () => ({
  campaigns: {
    list: vi.fn(),
    updateMember: vi.fn(),
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user1', role: 'player' } }),
}))

import { campaigns } from '../api'

// Campaign owned by the current user
const ownedGmCampaign = {
  id: 'c1',
  name: 'Lost Mines',
  description: null,
  is_gm_campaign: true,
  owner_id: 'user1',
  owner_display_name: 'Alice',
  gm_title: 'Dungeon Master',
  members: [{ user_id: 'user1', status: 'accepted' }],
  invitation_status: null,
  parent_campaign_id: null,
}

// Campaign owned by another user — current user is a member
const joinedGmCampaign = {
  id: 'c2',
  name: 'Dragon Heist',
  description: null,
  is_gm_campaign: true,
  owner_id: 'gm_user',
  owner_display_name: 'Bob',
  gm_title: 'Dungeon Master',
  members: [{ user_id: 'user1', status: 'accepted' }],
  invitation_status: 'accepted',
  parent_campaign_id: null,
}

function renderView() {
  return render(
    <MemoryRouter>
      <CampaignsView />
    </MemoryRouter>
  )
}

describe('CampaignsView', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows GM campaign name when user is the campaign owner', async () => {
    campaigns.list.mockResolvedValue([ownedGmCampaign])
    renderView()
    await waitFor(() => expect(screen.getByText('Lost Mines')).toBeTruthy())
  })

  it('shows the GM title for owned campaigns', async () => {
    campaigns.list.mockResolvedValue([ownedGmCampaign])
    renderView()
    await waitFor(() => screen.getByText('Lost Mines'))
    expect(screen.getByText('Dungeon Master')).toBeTruthy()
  })

  it('shows joined campaign under Joined Campaigns section', async () => {
    campaigns.list.mockResolvedValue([joinedGmCampaign])
    renderView()
    await waitFor(() => screen.getByText('Dragon Heist'))
    expect(screen.getByText('Joined Campaigns')).toBeTruthy()
  })

  it('shows owner display name for joined campaigns', async () => {
    campaigns.list.mockResolvedValue([joinedGmCampaign])
    renderView()
    await waitFor(() => screen.getByText('Dragon Heist'))
    expect(screen.getByText(/GM: Bob/)).toBeTruthy()
  })

  it('shows pending invitations section when there are invites', async () => {
    const invite = {
      ...joinedGmCampaign,
      id: 'c3',
      name: 'Curse of Strahd',
      invitation_status: 'invited',
    }
    campaigns.list.mockResolvedValue([invite])
    renderView()
    await waitFor(() => screen.getByText('Curse of Strahd'))
    expect(screen.getByText('Invitations')).toBeTruthy()
    expect(screen.getByText('Accept')).toBeTruthy()
    expect(screen.getByText('Decline')).toBeTruthy()
  })

  it('calls updateMember with accepted when Accept is clicked', async () => {
    const invite = {
      ...joinedGmCampaign,
      id: 'c3',
      name: 'Curse of Strahd',
      invitation_status: 'invited',
    }
    campaigns.list.mockResolvedValueOnce([invite]).mockResolvedValueOnce([])
    campaigns.updateMember.mockResolvedValue({})
    renderView()
    await waitFor(() => screen.getByText('Accept'))
    fireEvent.click(screen.getByText('Accept'))
    await waitFor(() =>
      expect(campaigns.updateMember).toHaveBeenCalledWith('c3', 'user1', 'accepted')
    )
  })

  it('shows empty state when there are no campaigns', async () => {
    campaigns.list.mockResolvedValue([])
    renderView()
    await waitFor(() => expect(screen.getByText('No campaigns yet')).toBeTruthy())
  })

  it('separates GM campaigns and personal campaigns into sections', async () => {
    const personal = {
      id: 'c4',
      name: 'My Solo Game',
      description: null,
      is_gm_campaign: false,
      owner_id: 'user1',
      owner_display_name: 'Alice',
      gm_title: null,
      members: [],
      invitation_status: null,
      parent_campaign_id: null,
    }
    campaigns.list.mockResolvedValue([ownedGmCampaign, personal])
    renderView()
    await waitFor(() => screen.getByText('Lost Mines'))
    expect(screen.getByText('GM Campaigns')).toBeTruthy()
    expect(screen.getByText('Personal Campaigns')).toBeTruthy()
  })
})
