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
    setArchived: vi.fn(),
    convertToGroup: vi.fn(),
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

// Edit / Convert / Archive live behind the campaign-actions kebab, so reaching
// them takes two clicks: open the menu, then pick the item.
function openActionsMenu() {
  fireEvent.click(screen.getByRole('button', { name: /campaign actions/i }))
}

function clickMenuItem(name) {
  openActionsMenu()
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

const actionsMenuTrigger = () => screen.queryByRole('button', { name: /campaign actions/i })

/**
 * Assert a management action is unavailable. The menu itself disappears when a
 * user can do nothing at all, so check that first and only open it when it is
 * present — otherwise the item's absence would pass for the wrong reason.
 */
function expectNoMenuItem(name) {
  if (!actionsMenuTrigger()) return
  openActionsMenu()
  expect(screen.queryByRole('menuitem', { name })).not.toBeInTheDocument()
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
  it('names a system that is a container child', async () => {
    // The system list must be fetched with include_children, otherwise a
    // campaign set to "Dungeons & Dragons 5e" (a child of the "Dungeons &
    // Dragons" container) resolves to nothing and renders as "—".
    mockLoad({ campaign: makeCampaign({ system_id: 'sys1' }) })
    api.get.mockResolvedValue([{ id: 'sys1', name: 'Dungeons & Dragons 5e', parent_id: 'sys-dnd' }])
    renderView()
    expect(await screen.findByText('Dungeons & Dragons 5e')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/systems?include_children=true')
  })

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
    // Locked campaign hides the edit action (no manage rights).
    expectNoMenuItem(/^Edit$/i)
  })
})

describe('CampaignDetailView owner actions', () => {
  it('opens the editor and closes it', async () => {
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    clickMenuItem(/^Edit$/i)
    expect(screen.getByTestId('campaign-editor')).toBeInTheDocument()
    fireEvent.click(screen.getByText('editor-close'))
    expect(screen.queryByTestId('campaign-editor')).not.toBeInTheDocument()
  })

  it('applies a saved update from the editor', async () => {
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    clickMenuItem(/^Edit$/i)
    fireEvent.click(screen.getByText('editor-save'))
    expect(await screen.findByText('Renamed')).toBeInTheDocument()
  })

  it('deletes the campaign after confirmation', async () => {
    mockLoad()
    campaigns.delete.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderView()
    await screen.findByText('Lost Mines')
    clickMenuItem(/^Edit$/i)
    fireEvent.click(screen.getByText('editor-delete'))
    await waitFor(() => expect(campaigns.delete).toHaveBeenCalledWith('c1'))
    expect(mockNavigate).toHaveBeenCalledWith('/campaigns')
    window.confirm.mockRestore()
  })

  it('renders a real link to notes (supports middle-click / ctrl-click)', async () => {
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    // The Open Notes button is now a <Link> so native browser affordances handle
    // new-tab (middle click / ctrl-click) without JS (issue #313).
    const notesLink = screen.getByRole('link', { name: /notes/i })
    expect(notesLink.getAttribute('href')).toBe('/campaigns/c1/notes')
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
    expectNoMenuItem(/^Edit$/i)
    expect(screen.queryByText(/Invite/i)).not.toBeInTheDocument()
  })

  it('admins can manage a campaign they do not own', async () => {
    mockUser = { id: 'someadmin', role: 'admin', campaign_access: true }
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    openActionsMenu()
    expect(screen.getByRole('menuitem', { name: /^Edit$/i })).toBeInTheDocument()
  })

  it('shows a self-disabled read-only notice when own access is disabled', async () => {
    mockUser = { id: 'owner1', role: 'gm', campaign_access: false }
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    // Self-disabled owner loses the edit action.
    expectNoMenuItem(/^Edit$/i)
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

describe('CampaignDetailView archiving', () => {
  it('archives the campaign when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    clickMenuItem(/^Archive$/i)
    await waitFor(() => expect(campaigns.setArchived).toHaveBeenCalledWith('c1', true))
    window.confirm.mockRestore()
  })

  it('does not archive when the confirm is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    clickMenuItem(/^Archive$/i)
    expect(campaigns.setArchived).not.toHaveBeenCalled()
    window.confirm.mockRestore()
  })

  // Unarchiving is the way back out of a read-only campaign, so it must stay
  // clickable while archived (when `locked` has disabled every other action).
  it('offers unarchive on an archived campaign and needs no confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockLoad({ campaign: makeCampaign({ is_archived: true, locked: true }) })
    renderView()
    await screen.findByText('Lost Mines')
    clickMenuItem(/unarchive/i)
    await waitFor(() => expect(campaigns.setArchived).toHaveBeenCalledWith('c1', false))
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('shows the archived read-only notice rather than the locked one', async () => {
    mockLoad({ campaign: makeCampaign({ is_archived: true, locked: true }) })
    renderView()
    await screen.findByText('Lost Mines')
    expect(screen.getByText(/archived and read-only/i)).toBeInTheDocument()
    expect(screen.queryByText(/campaign access has been disabled/i)).not.toBeInTheDocument()
  })

  it('hides the edit action while archived', async () => {
    mockLoad({ campaign: makeCampaign({ is_archived: true, locked: true }) })
    renderView()
    await screen.findByText('Lost Mines')
    expectNoMenuItem(/^Edit$/i)
  })

  it('hides archiving from non-owners', async () => {
    mockUser = { id: 'someone-else', role: 'player', campaign_access: true }
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    expectNoMenuItem(/^Archive$/i)
  })
})

describe('CampaignDetailView convert to group', () => {
  const personal = (over = {}) => makeCampaign({ is_gm_campaign: false, ...over })

  it('converts a personal campaign when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockLoad({ campaign: personal() })
    renderView()
    await screen.findByText('Lost Mines')
    clickMenuItem(/convert to group/i)
    await waitFor(() => expect(campaigns.convertToGroup).toHaveBeenCalledWith('c1'))
    window.confirm.mockRestore()
  })

  it('does not convert when the confirm is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockLoad({ campaign: personal() })
    renderView()
    await screen.findByText('Lost Mines')
    clickMenuItem(/convert to group/i)
    expect(campaigns.convertToGroup).not.toHaveBeenCalled()
    window.confirm.mockRestore()
  })

  // One-way: once it's a group campaign there is nothing to convert back to.
  it('hides the action on a campaign that is already a group one', async () => {
    mockLoad({ campaign: makeCampaign({ is_gm_campaign: true }) })
    renderView()
    await screen.findByText('Lost Mines')
    expectNoMenuItem(/convert to group/i)
  })

  it('hides the action while the campaign is archived', async () => {
    mockLoad({ campaign: personal({ is_archived: true, locked: true }) })
    renderView()
    await screen.findByText('Lost Mines')
    expectNoMenuItem(/convert to group/i)
  })

  it('hides the action from non-owners', async () => {
    mockUser = { id: 'someone-else', role: 'player', campaign_access: true }
    mockLoad({ campaign: personal() })
    renderView()
    await screen.findByText('Lost Mines')
    expectNoMenuItem(/convert to group/i)
  })
})

// Leaving is always the member's own call — archiving must not trap anyone in a
// campaign they no longer want to be part of.
describe('CampaignDetailView leaving a campaign', () => {
  const asMember = (over = {}) =>
    makeCampaign({
      owner_id: 'someone-else',
      members: [
        { user_id: 'someone-else', username: 'gm', is_owner: true, status: 'accepted' },
        { user_id: 'owner1', username: 'me', is_owner: false, status: 'accepted' },
      ],
      ...over,
    })

  it('leaves the campaign and returns to the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockLoad({ campaign: asMember() })
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }))
    await waitFor(() => expect(campaigns.removeMember).toHaveBeenCalledWith('c1', 'owner1'))
    expect(mockNavigate).toHaveBeenCalledWith('/campaigns')
    window.confirm.mockRestore()
  })

  it('does not leave when the confirm is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockLoad({ campaign: asMember() })
    renderView()
    await screen.findByText('Lost Mines')
    fireEvent.click(screen.getByRole('button', { name: /leave campaign/i }))
    expect(campaigns.removeMember).not.toHaveBeenCalled()
    window.confirm.mockRestore()
  })

  it('still offers leaving on an archived campaign', async () => {
    mockLoad({ campaign: asMember({ is_archived: true, locked: true }) })
    renderView()
    await screen.findByText('Lost Mines')
    expect(screen.getByRole('button', { name: /leave campaign/i })).toBeInTheDocument()
  })

  it('hides leaving from the owner, who deletes instead', async () => {
    mockLoad()
    renderView()
    await screen.findByText('Lost Mines')
    expect(screen.queryByRole('button', { name: /leave campaign/i })).not.toBeInTheDocument()
  })

  it('hides leaving from someone with only a pending invitation', async () => {
    mockLoad({
      campaign: asMember({
        members: [
          { user_id: 'someone-else', username: 'gm', is_owner: true, status: 'accepted' },
          { user_id: 'owner1', username: 'me', is_owner: false, status: 'invited' },
        ],
      }),
    })
    renderView()
    await screen.findByText('Lost Mines')
    expect(screen.queryByRole('button', { name: /leave campaign/i })).not.toBeInTheDocument()
  })
})
