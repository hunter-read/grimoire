import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CampaignDetailView from './CampaignDetailView'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../api', () => ({
  default: { get: vi.fn() },
  campaigns: {
    get: vi.fn(),
    getSchedule: vi.fn(),
    getAvailability: vi.fn(),
    delete: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    setCharacterName: vi.fn(),
    setAvailability: vi.fn(),
    cancelDate: vi.fn(),
  },
}))

let mockUser = { id: 'owner1', role: 'gm', campaign_access: true }
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

let mockGuestEnabled = false
vi.mock('../context/UISettingsContext', () => ({
  useUISettings: () => ({ guest_access_enabled: mockGuestEnabled }),
}))

// Stub the heavy child components so this suite stays focused on the view's own
// wiring and doesn't pull in their API/render trees.
vi.mock('../components/campaigns/CampaignEditor', () => ({
  default: ({ onClose, onSaved, onDelete }) => (
    <div data-testid="campaign-editor">
      <button onClick={onClose}>editor-close</button>
      <button onClick={() => onSaved({ name: 'Renamed' })}>editor-save</button>
      <button onClick={onDelete}>editor-delete</button>
    </div>
  ),
}))
vi.mock('../components/campaigns/WikiView', () => ({ default: () => <div /> }))
vi.mock('../components/campaigns/WikiMarkdown', () => ({
  default: ({ body }) => <div data-testid="wiki-md">{body}</div>,
}))
vi.mock('../components/campaigns/AvailabilityChart', () => ({
  default: () => <div data-testid="availability-chart" />,
}))
vi.mock('../components/campaigns/ResourcesPanel', () => ({
  default: () => <div data-testid="resources-panel" />,
}))
vi.mock('../components/campaigns/BannerHero', () => ({
  default: () => <div data-testid="banner-hero" />,
}))
vi.mock('../components/campaigns/MemberRow', () => ({
  default: ({ member, onRemove, onUpdateStatus, onSetCharacterName }) => (
    <div data-testid="member-row">
      {member.username}
      <button onClick={() => onRemove(member.user_id)}>remove-{member.user_id}</button>
      <button onClick={() => onUpdateStatus(member.user_id, 'accepted')}>
        accept-{member.user_id}
      </button>
      <button onClick={() => onSetCharacterName(member.user_id, 'Hero')}>
        setname-{member.user_id}
      </button>
    </div>
  ),
}))
vi.mock('../components/campaigns/InvitePanel', () => ({
  default: () => <div data-testid="invite-panel" />,
}))
vi.mock('../components/campaigns/GuestPanel', () => ({
  default: () => <div data-testid="guest-panel" />,
}))

import api, { campaigns } from '../api'

function makeCampaign(overrides = {}) {
  return {
    id: 'c1',
    name: 'Lost Mines',
    description: null,
    is_gm_campaign: true,
    owner_id: 'owner1',
    parent_campaign_id: null,
    system_id: null,
    system_name: null,
    locked: false,
    members: [
      {
        user_id: 'owner1',
        username: 'gm',
        is_owner: true,
        character_name: 'DM',
        status: 'accepted',
      },
      { user_id: 'p1', username: 'bob', is_owner: false, is_guest: false, status: 'accepted' },
    ],
    ...overrides,
  }
}

function mockLoad({ campaign = makeCampaign(), schedule = null, availability = null } = {}) {
  campaigns.get.mockResolvedValue(campaign)
  campaigns.getSchedule.mockResolvedValue(schedule)
  campaigns.getAvailability.mockResolvedValue(availability)
  api.get.mockResolvedValue([])
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/campaigns/c1']}>
      <Routes>
        <Route path="/campaigns/:campaignId" element={<CampaignDetailView />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { id: 'owner1', role: 'gm', campaign_access: true }
  mockGuestEnabled = false
})

describe('CampaignDetailView loading and errors', () => {
  it('shows a spinner until the campaign loads', async () => {
    let resolve
    campaigns.get.mockReturnValue(new Promise((r) => (resolve = r)))
    campaigns.getSchedule.mockResolvedValue(null)
    campaigns.getAvailability.mockResolvedValue(null)
    api.get.mockResolvedValue([])
    renderView()
    // Before resolving, the campaign name is not present.
    expect(screen.queryByText('Lost Mines')).not.toBeInTheDocument()
    resolve(makeCampaign())
    expect(await screen.findByText('Lost Mines')).toBeInTheDocument()
  })

  it('renders an error state with a back link when loading fails', async () => {
    campaigns.get.mockRejectedValue(new Error('Not found'))
    campaigns.getSchedule.mockResolvedValue(null)
    campaigns.getAvailability.mockResolvedValue(null)
    api.get.mockResolvedValue([])
    renderView()
    expect(await screen.findByText('Not found')).toBeInTheDocument()
    // The error state renders a single "← Campaigns" back button.
    fireEvent.click(screen.getByRole('button', { name: /campaigns/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/campaigns')
  })
})

describe('CampaignDetailView rendering', () => {
  it('renders the header, banner, members and resources', async () => {
    mockLoad()
    renderView()
    expect(await screen.findByText('Lost Mines')).toBeInTheDocument()
    expect(screen.getByTestId('banner-hero')).toBeInTheDocument()
    expect(screen.getByTestId('resources-panel')).toBeInTheDocument()
    // GM + one player member row.
    expect(screen.getAllByTestId('member-row')).toHaveLength(2)
  })

  it('renders the description via WikiMarkdown when present', async () => {
    mockLoad({ campaign: makeCampaign({ description: 'A grand quest' }) })
    renderView()
    expect(await screen.findByTestId('wiki-md')).toHaveTextContent('A grand quest')
  })

  it('shows a schedule summary in the meta row when a schedule exists', async () => {
    mockLoad({
      schedule: {
        enabled: true,
        definition: { frequency: 'weekly', days: [4], time_utc: null },
      },
    })
    renderView()
    // "Weekly" appears in the schedule summary line.
    expect(await screen.findByText(/Weekly/)).toBeInTheDocument()
  })

  it('shows the availability chart when the schedule is enabled', async () => {
    mockLoad({
      schedule: { enabled: true, definition: { frequency: 'weekly', days: [4] } },
    })
    renderView()
    expect(await screen.findByTestId('availability-chart')).toBeInTheDocument()
  })

  it('shows a read-only notice when the campaign is locked', async () => {
    mockLoad({ campaign: makeCampaign({ locked: true }) })
    renderView()
    await screen.findByText('Lost Mines')
    // Locked campaign hides the edit button (no manage rights).
    expect(screen.queryByText(/^Edit$/i)).not.toBeInTheDocument()
  })
})

describe('CampaignDetailView owner actions', () => {
  it('opens the editor and closes it', async () => {
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByText(/Edit/i))
    expect(screen.getByTestId('campaign-editor')).toBeInTheDocument()
    fireEvent.click(screen.getByText('editor-close'))
    expect(screen.queryByTestId('campaign-editor')).not.toBeInTheDocument()
  })

  it('applies a saved update from the editor', async () => {
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByText(/Edit/i))
    fireEvent.click(screen.getByText('editor-save'))
    expect(await screen.findByText('Renamed')).toBeInTheDocument()
  })

  it('deletes the campaign after confirmation', async () => {
    mockLoad()
    campaigns.delete.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByText(/Edit/i))
    fireEvent.click(screen.getByText('editor-delete'))
    await waitFor(() => expect(campaigns.delete).toHaveBeenCalledWith('c1'))
    expect(mockNavigate).toHaveBeenCalledWith('/campaigns')
    window.confirm.mockRestore()
  })

  it('navigates to notes', async () => {
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByText(/notes/i))
    expect(mockNavigate).toHaveBeenCalledWith('/campaigns/c1/notes')
  })

  it('toggles the invite panel', async () => {
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByText(/Invite/i))
    expect(screen.getByTestId('invite-panel')).toBeInTheDocument()
  })

  it('shows the guest button and panel when guest access is enabled', async () => {
    mockGuestEnabled = true
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByText(/Guests/i))
    expect(screen.getByTestId('guest-panel')).toBeInTheDocument()
  })
})

describe('CampaignDetailView permissions', () => {
  it('hides owner actions for a non-owner player', async () => {
    mockUser = { id: 'p1', role: 'player', campaign_access: true }
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    expect(screen.queryByText(/^Edit$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Invite/i)).not.toBeInTheDocument()
  })

  it('admins can manage a campaign they do not own', async () => {
    mockUser = { id: 'someadmin', role: 'admin', campaign_access: true }
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    expect(screen.getByText(/Edit/i)).toBeInTheDocument()
  })

  it('shows a self-disabled read-only notice when own access is disabled', async () => {
    mockUser = { id: 'owner1', role: 'gm', campaign_access: false }
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    // Self-disabled owner loses the edit button.
    expect(screen.queryByText(/^Edit$/i)).not.toBeInTheDocument()
  })
})

describe('CampaignDetailView member handlers', () => {
  it('removes a member after confirmation and reloads', async () => {
    mockLoad()
    campaigns.removeMember.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderView()
    await screen.findByText('Lost Mines')
    campaigns.get.mockClear()
    fireEvent.click(screen.getByText('remove-p1'))
    await waitFor(() => expect(campaigns.removeMember).toHaveBeenCalledWith('c1', 'p1'))
    await waitFor(() => expect(campaigns.get).toHaveBeenCalled())
    window.confirm.mockRestore()
  })

  it('skips removal when the confirmation is declined', async () => {
    mockLoad()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByText('remove-p1'))
    expect(campaigns.removeMember).not.toHaveBeenCalled()
    window.confirm.mockRestore()
  })

  it('updates a member status and reloads', async () => {
    mockLoad()
    campaigns.updateMember.mockResolvedValue({})
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByText('accept-p1'))
    await waitFor(() => expect(campaigns.updateMember).toHaveBeenCalledWith('c1', 'p1', 'accepted'))
  })

  it('sets a character name and reloads', async () => {
    mockLoad()
    campaigns.setCharacterName.mockResolvedValue({})
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByText('setname-p1'))
    await waitFor(() => expect(campaigns.setCharacterName).toHaveBeenCalledWith('c1', 'p1', 'Hero'))
  })
})

describe('CampaignDetailView schedule summaries', () => {
  it('summarises a custom-dates schedule', async () => {
    mockLoad({
      schedule: {
        enabled: true,
        definition: { frequency: 'custom', custom_dates: ['2026-08-01', '2026-08-15'] },
      },
    })
    renderView()
    // The custom frequency label appears in the meta row.
    expect(await screen.findByText(/Custom/i)).toBeInTheDocument()
  })

  it('summarises a monthly schedule', async () => {
    mockLoad({
      schedule: {
        enabled: true,
        definition: { frequency: 'monthly', days: [4], monthly_week: 2, time_utc: '19:00' },
      },
    })
    renderView()
    expect(await screen.findByText(/Monthly/i)).toBeInTheDocument()
  })
})
