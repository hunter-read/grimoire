import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The header reads `isMobilePhone` via useIsMobile(640), so stub matchMedia to
// report a phone BEFORE importing the view, then load it dynamically. This
// exercises the mobile-only header branches the desktop test can't reach.
vi.mock('../api', () => ({
  campaigns: {
    list: vi.fn(),
    updateMember: vi.fn(),
  },
}))

let mockUser = { id: 'user1', role: 'gm' }
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

vi.mock('../components/campaigns/CampaignEditor', () => ({
  default: () => <div>campaign-editor</div>,
}))

import { campaigns } from '../api'

let CampaignsView

beforeAll(async () => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })
  vi.resetModules()
  CampaignsView = (await import('./CampaignsView')).default
})

function renderView() {
  return render(
    <MemoryRouter>
      <CampaignsView />
    </MemoryRouter>
  )
}

describe('CampaignsView header on a phone', () => {
  beforeEach(() => {
    mockUser = { id: 'user1', role: 'gm' }
    campaigns.list.mockResolvedValue([])
  })

  it('collapses the header controls to icons that keep accessible names', async () => {
    renderView()
    await waitFor(() => expect(campaigns.list).toHaveBeenCalled())

    // Each control is still reachable by its name even though the visible text
    // label is dropped at this width.
    const archived = screen.getByRole('button', { name: 'Archived' })
    const create = screen.getByRole('button', { name: 'New Campaign' })
    const calendar = screen.getByRole('button', { name: 'Calendar' })

    // The labels are gone from the rendered text — that is what stops the
    // controls from squeezing the title on a narrow screen.
    expect(archived).toHaveTextContent('')
    expect(create).toHaveTextContent('')
    expect(calendar).toHaveTextContent('')
  })

  it('stacks the title above the controls instead of sharing one row', async () => {
    renderView()
    await waitFor(() => expect(campaigns.list).toHaveBeenCalled())

    const header = screen.getByRole('heading', { name: /Campaigns/ }).parentElement
    expect(header).toHaveStyle({ flexDirection: 'column' })
  })

  it('still shows the access-disabled note as text when creation is blocked', async () => {
    mockUser = { id: 'user1', role: 'player', campaign_access: false }
    renderView()
    await waitFor(() => expect(campaigns.list).toHaveBeenCalled())

    expect(screen.queryByRole('button', { name: 'New Campaign' })).not.toBeInTheDocument()
    expect(screen.getByText('Campaign access disabled')).toBeInTheDocument()
  })
})
