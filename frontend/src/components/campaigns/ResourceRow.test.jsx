import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ResourceRow from './ResourceRow'

vi.mock('../../api', () => ({
  campaigns: { fileUrl: (cid, id) => `http://localhost/campaigns/${cid}/files/${id}` },
  mediaUrl: (p) => `http://localhost${p}`,
}))
vi.mock('../audio/AudioPlayer', () => ({
  default: ({ track }) => <span data-testid="audio-player">{track?.id}</span>,
}))

beforeEach(() => vi.clearAllMocks())

const resource = (over = {}) => ({
  id: 'r1',
  resource_type: 'audio',
  resource_id: 'a1',
  name: 'Tavern Night',
  has_thumbnail: true,
  is_image: false,
  visibility: 'public',
  category_id: null,
  ...over,
})

const baseProps = (over = {}) => ({
  campaignId: 'c1',
  isOwner: false,
  isGmCampaign: false,
  members: [],
  categories: [],
  onRemove: vi.fn(),
  onSetVisibility: vi.fn(),
  onSetShares: vi.fn(),
  onSetCategory: vi.fn(),
  onDragStart: vi.fn(),
  ...over,
})

function renderRow(resourceOver = {}, propsOver = {}) {
  return render(
    <MemoryRouter>
      <ResourceRow resource={resource(resourceOver)} {...baseProps(propsOver)} />
    </MemoryRouter>
  )
}

describe('ResourceRow — audio', () => {
  it('renders an audio player and uses the artwork endpoint for the thumbnail', () => {
    const { container } = renderRow()
    expect(screen.getByTestId('audio-player')).toHaveTextContent('a1')
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toContain('/audio/a1/artwork')
  })

  // Title is now a real <Link> — middle/ctrl-click opens in a new tab natively.
  it('renders the title as a link to the audio detail page', () => {
    renderRow()
    const link = screen.getByRole('link', { name: /open tavern night/i })
    expect(link.getAttribute('href')).toBe('/audio/a1')
  })
})

describe('ResourceRow — other types', () => {
  // File resources render a plain <a href target="_blank"> — opens in a new tab
  // natively on any click (primary or modified).
  it('renders a file resource title as an anchor opening in a new tab', () => {
    renderRow({ resource_type: 'file', resource_id: 'f1', name: 'handout.pdf' })
    const link = screen.getByRole('link', { name: /open handout\.pdf/i })
    expect(link.getAttribute('href')).toContain('/campaigns/c1/files/f1')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('owner sees a remove control', async () => {
    const onRemove = vi.fn()
    renderRow(
      { resource_type: 'map', resource_id: 'm1', name: 'Cave' },
      { isOwner: true, onRemove }
    )
    await userEvent.click(screen.getByRole('button', { name: /remove cave/i }))
    expect(onRemove).toHaveBeenCalled()
  })

  it('owner in a GM campaign can change visibility and category', async () => {
    const onSetVisibility = vi.fn()
    const onSetCategory = vi.fn()
    renderRow(
      { resource_type: 'map', resource_id: 'm1', name: 'Cave' },
      {
        isOwner: true,
        isGmCampaign: true,
        categories: [{ id: 'c1', name: 'Handouts' }],
        onSetVisibility,
        onSetCategory,
      }
    )
    const selects = screen.getAllByRole('combobox')
    await userEvent.selectOptions(selects[0], 'private')
    expect(onSetVisibility).toHaveBeenCalledWith('r1', 'private')
    await userEvent.selectOptions(selects[1], 'c1')
    expect(onSetCategory).toHaveBeenCalledWith('r1', 'c1')
  })

  it('renders private-share checkboxes for a private resource in a GM campaign', async () => {
    const onSetShares = vi.fn()
    renderRow(
      {
        resource_type: 'map',
        resource_id: 'm1',
        name: 'Cave',
        visibility: 'private',
        shared_user_ids: [],
      },
      {
        isOwner: true,
        isGmCampaign: true,
        members: [{ user_id: 'u2', username: 'bob' }],
        onSetShares,
      }
    )
    const checkbox = screen.getByRole('checkbox')
    await userEvent.click(checkbox)
    expect(onSetShares).toHaveBeenCalledWith('r1', ['u2'])
  })

  it('non-owner in a GM campaign sees the visibility label', () => {
    renderRow(
      { resource_type: 'map', resource_id: 'm1', name: 'Cave' },
      { isOwner: false, isGmCampaign: true }
    )
    // The visibility text label is shown instead of editor controls.
    expect(screen.getByText(/public/i)).toBeInTheDocument()
  })
})
