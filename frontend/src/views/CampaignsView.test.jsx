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

let mockUser = { id: 'user1', role: 'player' }
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// Stub the editor so we can assert it opens without pulling in its full tree.
vi.mock('../components/campaigns/CampaignEditor', () => ({
  default: ({ onClose, onSaved }) => (
    <div>
      <div>campaign-editor</div>
      <button onClick={onClose}>editor-close</button>
      <button onClick={() => onSaved({ id: 'new-c' })}>editor-save</button>
    </div>
  ),
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
    mockUser = { id: 'user1', role: 'player' }
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

  it('calls updateMember with declined when Decline is clicked', async () => {
    const invite = {
      ...joinedGmCampaign,
      id: 'c3',
      name: 'Curse of Strahd',
      description: 'A gothic horror campaign',
      invitation_status: 'invited',
    }
    campaigns.list.mockResolvedValueOnce([invite]).mockResolvedValueOnce([])
    campaigns.updateMember.mockResolvedValue({})
    renderView()
    await waitFor(() => screen.getByText('Decline'))
    // The invite row renders its description too.
    expect(screen.getByText('A gothic horror campaign')).toBeTruthy()
    fireEvent.click(screen.getByText('Decline'))
    await waitFor(() =>
      expect(campaigns.updateMember).toHaveBeenCalledWith('c3', 'user1', 'declined')
    )
  })

  it('shows an error message when the list request fails', async () => {
    campaigns.list.mockRejectedValue(new Error('boom'))
    renderView()
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy())
  })

  it('opens the editor from the new-campaign button and closes it', async () => {
    campaigns.list.mockResolvedValue([])
    renderView()
    await waitFor(() => screen.getByText('No campaigns yet'))
    fireEvent.click(screen.getByText(/new campaign/i))
    expect(screen.getByText('campaign-editor')).toBeTruthy()
    fireEvent.click(screen.getByText('editor-close'))
    await waitFor(() => expect(screen.queryByText('campaign-editor')).toBeNull())
  })

  it('navigates to the new campaign after the editor saves', async () => {
    campaigns.list.mockResolvedValue([])
    renderView()
    await waitFor(() => screen.getByText('No campaigns yet'))
    fireEvent.click(screen.getByText(/new campaign/i))
    fireEvent.click(screen.getByText('editor-save'))
    await waitFor(() => expect(screen.queryByText('campaign-editor')).toBeNull())
  })

  it('hides the create button and shows a hint when access is disabled', async () => {
    mockUser = { id: 'user1', role: 'player', campaign_access: false }
    campaigns.list.mockResolvedValue([])
    renderView()
    await waitFor(() => screen.getByText('No campaigns yet'))
    expect(screen.queryByText(/new campaign/i)).toBeNull()
    expect(screen.getByText(/access disabled/i)).toBeTruthy()
  })

  // Archived campaigns are excluded server-side, so the toggle refetches rather
  // than filtering the payload already in hand.
  describe('archived campaigns', () => {
    const archivedCampaign = {
      ...ownedGmCampaign,
      id: 'c9',
      name: 'Finished Game',
      is_archived: true,
    }

    it('requests active campaigns only by default', async () => {
      campaigns.list.mockResolvedValue([ownedGmCampaign])
      renderView()
      await waitFor(() => screen.getByText('Lost Mines'))
      expect(campaigns.list).toHaveBeenCalledWith(false)
    })

    it('refetches with archived included when the toggle is pressed', async () => {
      campaigns.list.mockResolvedValue([ownedGmCampaign])
      renderView()
      await waitFor(() => screen.getByText('Lost Mines'))
      fireEvent.click(screen.getByRole('button', { name: /archived/i }))
      await waitFor(() => expect(campaigns.list).toHaveBeenCalledWith(true))
    })

    it('reflects the toggle state with aria-pressed', async () => {
      campaigns.list.mockResolvedValue([ownedGmCampaign])
      renderView()
      await waitFor(() => screen.getByText('Lost Mines'))
      const toggle = screen.getByRole('button', { name: /archived/i })
      expect(toggle.getAttribute('aria-pressed')).toBe('false')
      fireEvent.click(toggle)
      await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'))
    })

    it('lists archived campaigns in their own section once toggled on', async () => {
      campaigns.list.mockResolvedValue([ownedGmCampaign, archivedCampaign])
      renderView()
      await waitFor(() => screen.getByText('Lost Mines'))
      fireEvent.click(screen.getByRole('button', { name: /archived/i }))
      await waitFor(() => expect(screen.getByText('Finished Game')).toBeTruthy())
      expect(screen.getByText('Archived Campaigns')).toBeTruthy()
    })

    it('keeps archived campaigns out of the active sections', async () => {
      // Both are owned GM campaigns; only the active one belongs under that heading.
      campaigns.list.mockResolvedValue([ownedGmCampaign, archivedCampaign])
      renderView()
      await waitFor(() => screen.getByText('Lost Mines'))
      fireEvent.click(screen.getByRole('button', { name: /archived/i }))
      await waitFor(() => screen.getByText('Finished Game'))
      const gmHeading = screen.getByText('GM Campaigns')
      const archivedHeading = screen.getByText('Archived Campaigns')
      // The archived card sits under the archived heading, not the GM one.
      expect(gmHeading.parentElement.textContent).not.toContain('Finished Game')
      expect(archivedHeading.parentElement.textContent).toContain('Finished Game')
    })

    it('does not render the archived section when the toggle is off', async () => {
      campaigns.list.mockResolvedValue([ownedGmCampaign])
      renderView()
      await waitFor(() => screen.getByText('Lost Mines'))
      expect(screen.queryByText('Archived Campaigns')).toBeNull()
    })
  })
})
