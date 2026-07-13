import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResourceRow from './ResourceRow'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
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

describe('ResourceRow — audio', () => {
  it('renders an audio player and uses the artwork endpoint for the thumbnail', () => {
    const { container } = render(<ResourceRow resource={resource()} {...baseProps()} />)
    expect(screen.getByTestId('audio-player')).toHaveTextContent('a1')
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toContain('/audio/a1/artwork')
  })

  it('navigates to the audio detail page on title click', async () => {
    render(<ResourceRow resource={resource()} {...baseProps()} />)
    await userEvent.click(screen.getByText('Tavern Night'))
    expect(navigate).toHaveBeenCalledWith('/audio/a1', expect.anything())
  })
})

describe('ResourceRow — other types', () => {
  it('opens a file resource in a new tab instead of navigating', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <ResourceRow
        resource={resource({ resource_type: 'file', resource_id: 'f1', name: 'handout.pdf' })}
        {...baseProps()}
      />
    )
    await userEvent.click(screen.getByText('handout.pdf'))
    expect(openSpy).toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it('owner sees a remove control', async () => {
    const onRemove = vi.fn()
    render(
      <ResourceRow
        resource={resource({ resource_type: 'map', resource_id: 'm1', name: 'Cave' })}
        {...baseProps({ isOwner: true, onRemove })}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /remove cave/i }))
    expect(onRemove).toHaveBeenCalled()
  })

  it('owner in a GM campaign can change visibility and category', async () => {
    const onSetVisibility = vi.fn()
    const onSetCategory = vi.fn()
    render(
      <ResourceRow
        resource={resource({ resource_type: 'map', resource_id: 'm1', name: 'Cave' })}
        {...baseProps({
          isOwner: true,
          isGmCampaign: true,
          categories: [{ id: 'c1', name: 'Handouts' }],
          onSetVisibility,
          onSetCategory,
        })}
      />
    )
    const selects = screen.getAllByRole('combobox')
    await userEvent.selectOptions(selects[0], 'private')
    expect(onSetVisibility).toHaveBeenCalledWith('r1', 'private')
    await userEvent.selectOptions(selects[1], 'c1')
    expect(onSetCategory).toHaveBeenCalledWith('r1', 'c1')
  })

  it('renders private-share checkboxes for a private resource in a GM campaign', async () => {
    const onSetShares = vi.fn()
    render(
      <ResourceRow
        resource={resource({
          resource_type: 'map',
          resource_id: 'm1',
          name: 'Cave',
          visibility: 'private',
          shared_user_ids: [],
        })}
        {...baseProps({
          isOwner: true,
          isGmCampaign: true,
          members: [{ user_id: 'u2', username: 'bob' }],
          onSetShares,
        })}
      />
    )
    const checkbox = screen.getByRole('checkbox')
    await userEvent.click(checkbox)
    expect(onSetShares).toHaveBeenCalledWith('r1', ['u2'])
  })

  it('non-owner in a GM campaign sees the visibility label', () => {
    render(
      <ResourceRow
        resource={resource({ resource_type: 'map', resource_id: 'm1', name: 'Cave' })}
        {...baseProps({ isOwner: false, isGmCampaign: true })}
      />
    )
    // The visibility text label is shown instead of editor controls.
    expect(screen.getByText(/public/i)).toBeInTheDocument()
  })
})
