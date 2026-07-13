import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PendingInvitesBanner from './PendingInvitesBanner'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('../../api', () => ({
  campaigns: {
    invites: vi.fn(),
    updateMember: vi.fn(),
  },
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user1', role: 'player' } }),
}))

import { campaigns } from '../../api'

const oneInvite = [
  { campaign_id: 'c1', name: 'Lost Mines', description: '', owner_display_name: 'Alice' },
]
const twoInvites = [
  { campaign_id: 'c1', name: 'Lost Mines', description: '', owner_display_name: 'Alice' },
  { campaign_id: 'c2', name: 'Dragon Heist', description: '', owner_display_name: 'Bob' },
]

function renderBanner() {
  return render(
    <MemoryRouter>
      <PendingInvitesBanner />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe('PendingInvitesBanner', () => {
  it('renders nothing when there are no invites', async () => {
    campaigns.invites.mockResolvedValue([])
    const { container } = renderBanner()
    await waitFor(() => expect(campaigns.invites).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('shows accept/decline for a single invite naming the campaign and GM', async () => {
    campaigns.invites.mockResolvedValue(oneInvite)
    renderBanner()
    expect(await screen.findByText(/Lost Mines/)).toBeTruthy()
    expect(screen.getByText(/Alice/)).toBeTruthy()
    expect(screen.getByText('Accept')).toBeTruthy()
    expect(screen.getByText('Decline')).toBeTruthy()
  })

  it('accepting calls updateMember and hides the invite', async () => {
    // First fetch has the invite; the reload after accepting reflects the server
    // having cleared it.
    campaigns.invites.mockResolvedValueOnce(oneInvite).mockResolvedValue([])
    campaigns.updateMember.mockResolvedValue({})
    renderBanner()
    fireEvent.click(await screen.findByText('Accept'))
    await waitFor(() =>
      expect(campaigns.updateMember).toHaveBeenCalledWith('c1', 'user1', 'accepted')
    )
    await waitFor(() => expect(screen.queryByText(/Lost Mines/)).toBeNull())
  })

  it('declining calls updateMember with declined', async () => {
    campaigns.invites.mockResolvedValue(oneInvite)
    campaigns.updateMember.mockResolvedValue({})
    renderBanner()
    fireEvent.click(await screen.findByText('Decline'))
    await waitFor(() =>
      expect(campaigns.updateMember).toHaveBeenCalledWith('c1', 'user1', 'declined')
    )
  })

  it('shows a count and View button for multiple invites', async () => {
    campaigns.invites.mockResolvedValue(twoInvites)
    renderBanner()
    const view = await screen.findByText('View')
    expect(screen.getByText(/2/)).toBeTruthy()
    fireEvent.click(view)
    expect(navigate).toHaveBeenCalledWith('/campaigns')
  })

  it('dismiss hides the banner and persists to sessionStorage', async () => {
    campaigns.invites.mockResolvedValue(oneInvite)
    renderBanner()
    await screen.findByText(/Lost Mines/)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    await waitFor(() => expect(screen.queryByText(/Lost Mines/)).toBeNull())
    expect(sessionStorage.getItem('grimoire:invites_dismissed')).toBe('true')
  })

  it('stays dismissed when sessionStorage already has the flag', async () => {
    sessionStorage.setItem('grimoire:invites_dismissed', 'true')
    campaigns.invites.mockResolvedValue(oneInvite)
    renderBanner()
    await waitFor(() => expect(campaigns.invites).toHaveBeenCalled())
    expect(screen.queryByText(/Lost Mines/)).toBeNull()
  })
})
