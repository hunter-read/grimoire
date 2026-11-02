import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CampaignNotesView from './CampaignNotesView'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ campaignId: 'c1' }) }
})

vi.mock('../api', () => ({ campaigns: { get: vi.fn() } }))

let mockUser = { id: 'owner1', role: 'admin', campaign_access: true }
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

// Stub WikiView: expose a button that flips onViewingNoteChange so we can assert
// the parent header hides/shows without rendering the whole wiki.
vi.mock('../components/campaigns/WikiView', () => ({
  default: ({ onViewingNoteChange }: { onViewingNoteChange: (viewing: boolean) => void }) => (
    <div data-testid="wiki">
      <button data-testid="open-note" onClick={() => onViewingNoteChange(true)} />
      <button data-testid="close-note" onClick={() => onViewingNoteChange(false)} />
    </div>
  ),
}))

import { campaigns } from '../api'
const mockCampaigns = campaigns as unknown as Record<keyof typeof campaigns, Mock>

const renderView = () =>
  render(
    <MemoryRouter>
      <CampaignNotesView />
    </MemoryRouter>
  )

describe('CampaignNotesView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = { id: 'owner1', role: 'admin', campaign_access: true }
    mockCampaigns.get.mockResolvedValue({ id: 'c1', name: 'The Tithe', owner_id: 'owner1' })
  })

  it('shows a spinner until the campaign loads', () => {
    mockCampaigns.get.mockReturnValue(new Promise(() => {}))
    const { container } = renderView()
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByText('The Tithe')).not.toBeInTheDocument()
  })

  it('renders the header (campaign name + back button) and the wiki', async () => {
    renderView()
    expect(await screen.findByText('The Tithe')).toBeInTheDocument()
    expect(screen.getByTestId('wiki')).toBeInTheDocument()
  })

  it('links back to the overview', async () => {
    renderView()
    await screen.findByText('The Tithe')
    expect(screen.getByRole('link', { name: /overview/i })).toHaveAttribute(
      'href',
      '/campaigns/c1/overview'
    )
  })

  it('names the page with an h1 and the tab title', async () => {
    renderView()
    expect(await screen.findByRole('heading', { level: 1, name: 'The Tithe' })).toBeInTheDocument()
    expect(document.title).toMatch(/The Tithe/)
  })

  it('hides the header while a note is being viewed, and restores it on return', async () => {
    renderView()
    await screen.findByText('The Tithe')

    fireEvent.click(screen.getByTestId('open-note'))
    // The visible header goes; the h1 stays, for screen readers only.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /overview/i })).not.toBeInTheDocument()
    )
    expect(screen.getByRole('heading', { level: 1, name: 'The Tithe' })).toHaveClass('sr-only')

    fireEvent.click(screen.getByTestId('close-note'))
    expect(await screen.findByRole('link', { name: /overview/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'The Tithe' })).not.toHaveClass('sr-only')
  })

  it('renders an error message when the campaign fails to load', async () => {
    mockCampaigns.get.mockRejectedValue(new Error('nope'))
    renderView()
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })
})
