import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CampaignNotesView from './CampaignNotesView'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ campaignId: 'c1' }) }
})

vi.mock('../api', () => ({ campaigns: { get: vi.fn() } }))

let mockUser = { id: 'owner1', role: 'admin', campaign_access: true }
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

// Stub WikiView: expose a button that flips onViewingNoteChange so we can assert
// the parent header hides/shows without rendering the whole wiki.
vi.mock('../components/campaigns/WikiView', () => ({
  default: ({ onViewingNoteChange }) => (
    <div data-testid="wiki">
      <button data-testid="open-note" onClick={() => onViewingNoteChange(true)} />
      <button data-testid="close-note" onClick={() => onViewingNoteChange(false)} />
    </div>
  ),
}))

import { campaigns } from '../api'

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
    campaigns.get.mockResolvedValue({ id: 'c1', name: 'The Tithe', owner_id: 'owner1' })
  })

  it('shows a spinner until the campaign loads', () => {
    campaigns.get.mockReturnValue(new Promise(() => {}))
    const { container } = renderView()
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByText('The Tithe')).not.toBeInTheDocument()
  })

  it('renders the header (campaign name + back button) and the wiki', async () => {
    renderView()
    expect(await screen.findByText('The Tithe')).toBeInTheDocument()
    expect(screen.getByTestId('wiki')).toBeInTheDocument()
  })

  it('navigates back to the overview when the back button is clicked', async () => {
    renderView()
    await screen.findByText('The Tithe')
    fireEvent.click(screen.getByRole('button', { name: /overview/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/campaigns/c1/overview')
  })

  it('hides the header while a note is being viewed, and restores it on return', async () => {
    renderView()
    await screen.findByText('The Tithe')

    fireEvent.click(screen.getByTestId('open-note'))
    await waitFor(() => expect(screen.queryByText('The Tithe')).not.toBeInTheDocument())

    fireEvent.click(screen.getByTestId('close-note'))
    expect(await screen.findByText('The Tithe')).toBeInTheDocument()
  })

  it('renders an error message when the campaign fails to load', async () => {
    campaigns.get.mockRejectedValue(new Error('nope'))
    renderView()
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })
})
