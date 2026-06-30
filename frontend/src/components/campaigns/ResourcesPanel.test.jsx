import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResourcesPanel from './ResourcesPanel'
import { campaigns } from '../../api'

vi.mock('../../api', () => ({
  campaigns: {
    listResources: vi.fn(),
    listCategories: vi.fn(),
    removeResource: vi.fn(),
    updateResource: vi.fn(),
    uploadFile: vi.fn(),
    reorderResources: vi.fn(),
  },
}))

const playQueue = vi.fn()
vi.mock('../../context/AudioPlayerContext', () => ({ useAudioPlayer: () => ({ playQueue }) }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../context/UISettingsContext', () => ({
  useUISettings: () => ({ campaign_uploads_disabled: false }),
}))
// Render each resource row with buttons that fire the owner-action callbacks,
// so the panel's remove/visibility/category handlers are exercised.
vi.mock('./ResourceRow', () => ({
  default: ({ resource, onRemove, onSetVisibility, onSetCategory, onSetShares, onDragStart }) => (
    <div>
      <span>{resource.name}</span>
      <button onClick={() => onRemove(resource)}>{`remove-${resource.id}`}</button>
      <button
        onClick={() => onSetVisibility(resource.id, 'private')}
      >{`vis-${resource.id}`}</button>
      <button onClick={() => onSetCategory(resource.id, 'cat1')}>{`cat-${resource.id}`}</button>
      <button onClick={() => onSetShares(resource.id, ['u2'])}>{`share-${resource.id}`}</button>
      <button onClick={() => onDragStart({ dataTransfer: { effectAllowed: '' } }, resource)}>
        {`drag-${resource.id}`}
      </button>
    </div>
  ),
}))
vi.mock('./CategoryManager', () => ({
  default: ({ onClose, onChanged, onGroupOrderChange }) => (
    <div data-testid="category-manager">
      <button onClick={() => onGroupOrderChange(['type:audio', 'type:map'])}>reorder-groups</button>
      <button onClick={onChanged}>cats-changed</button>
      <button onClick={onClose}>close-cats</button>
    </div>
  ),
}))
vi.mock('./ResourcePicker', () => ({
  default: ({ onAdd, onClose }) => (
    <div data-testid="resource-picker">
      <button onClick={onAdd}>picker-added</button>
      <button onClick={onClose}>close-picker</button>
    </div>
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  campaigns.listCategories.mockResolvedValue([])
})

const campaign = { id: 'c1', is_gm_campaign: true, resource_group_order: [] }

const resources = [
  { id: 'r1', resource_type: 'audio', resource_id: 'a1', name: 'Tavern', has_thumbnail: true },
  { id: 'r2', resource_type: 'audio', resource_id: 'a2', name: 'Battle', has_thumbnail: false },
  { id: 'r3', resource_type: 'map', resource_id: 'm1', name: 'Cave', has_thumbnail: false },
]

describe('ResourcesPanel', () => {
  it('renders resources grouped by type', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Tavern')).toBeInTheDocument())
    expect(screen.getByText('Battle')).toBeInTheDocument()
    expect(screen.getByText('Cave')).toBeInTheDocument()
  })

  it('shows a GM-only Play button on an audio group that queues its tracks', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => screen.getByText('Tavern'))
    await userEvent.click(screen.getByTitle(/play audio/i))
    expect(playQueue).toHaveBeenCalledTimes(1)
    expect(playQueue.mock.calls[0][0].map((t) => t.id)).toEqual(['a1', 'a2'])
  })

  it('hides the group Play button for non-owners', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    render(<ResourcesPanel campaign={campaign} isOwner={false} onRefresh={vi.fn()} />)
    await waitFor(() => screen.getByText('Tavern'))
    expect(screen.queryByTitle(/play audio/i)).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no resources', async () => {
    campaigns.listResources.mockResolvedValue([])
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => expect(campaigns.listResources).toHaveBeenCalled())
    // Audio group has no items → no play button.
    expect(screen.queryByTitle(/play audio/i)).not.toBeInTheDocument()
  })

  it('removes a resource and reloads', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    campaigns.removeResource.mockResolvedValue({})
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => screen.getByText('Cave'))
    await userEvent.click(screen.getByText('remove-r3'))
    expect(campaigns.removeResource).toHaveBeenCalledWith('c1', 'r3')
  })

  it('updates visibility, category, and shares via row controls', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    campaigns.updateResource.mockResolvedValue({})
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => screen.getByText('Cave'))
    await userEvent.click(screen.getByText('vis-r1'))
    expect(campaigns.updateResource).toHaveBeenCalledWith('c1', 'r1', { visibility: 'private' })
    await userEvent.click(screen.getByText('cat-r1'))
    expect(campaigns.updateResource).toHaveBeenCalledWith('c1', 'r1', { category_id: 'cat1' })
    await userEvent.click(screen.getByText('share-r1'))
    expect(campaigns.updateResource).toHaveBeenCalledWith('c1', 'r1', { shared_user_ids: ['u2'] })
  })

  it('opens the category manager and the resource picker', async () => {
    campaigns.listResources.mockResolvedValue([])
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => expect(campaigns.listResources).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /categories/i }))
    expect(screen.getByTestId('category-manager')).toBeInTheDocument()
    await userEvent.click(screen.getByText('close-cats'))

    await userEvent.click(screen.getByRole('button', { name: /link|add/i }))
    expect(screen.getByTestId('resource-picker')).toBeInTheDocument()
  })

  it('uploads a file', async () => {
    campaigns.listResources.mockResolvedValue([])
    campaigns.uploadFile.mockResolvedValue({})
    const { container } = render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => expect(campaigns.listResources).toHaveBeenCalled())
    const input = container.querySelector('input[type="file"]')
    const file = new File(['x'], 'handout.pdf', { type: 'application/pdf' })
    await userEvent.upload(input, file)
    expect(campaigns.uploadFile).toHaveBeenCalledWith('c1', file)
  })

  it('renders custom category groups', async () => {
    campaigns.listResources.mockResolvedValue([
      { id: 'r1', resource_type: 'map', resource_id: 'm1', name: 'Cave', category_id: 'cat1' },
    ])
    campaigns.listCategories.mockResolvedValue([
      { id: 'cat1', name: 'Handouts', sort_order: 0, kind: 'resource' },
    ])
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/Handouts/)).toBeInTheDocument())
    expect(screen.getByText('Cave')).toBeInTheDocument()
  })

  it('starts a drag without throwing (drag handlers wired for owners)', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => screen.getByText('Cave'))
    // The drag-start handler records the dragged id (no throw).
    await userEvent.click(screen.getByText('drag-r1'))
    expect(screen.getByText('Cave')).toBeInTheDocument()
  })

  it('reloads when the resource picker reports an addition', async () => {
    campaigns.listResources.mockResolvedValue([])
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => expect(campaigns.listResources).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /link|add/i }))
    campaigns.listResources.mockClear()
    await userEvent.click(screen.getByText('picker-added'))
    expect(campaigns.listResources).toHaveBeenCalled()
  })

  it('reorders groups and reloads from the category manager', async () => {
    campaigns.listResources.mockResolvedValue([])
    const onRefresh = vi.fn()
    render(<ResourcesPanel campaign={campaign} isOwner onRefresh={onRefresh} />)
    await waitFor(() => expect(campaigns.listResources).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /categories/i }))
    await userEvent.click(screen.getByText('reorder-groups'))
    await userEvent.click(screen.getByText('cats-changed'))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('reorders a resource when dropped onto another resource', async () => {
    campaigns.listResources.mockResolvedValue(resources)
    campaigns.reorderResources.mockResolvedValue({})
    const { container } = render(<ResourcesPanel campaign={campaign} isOwner onRefresh={vi.fn()} />)
    await waitFor(() => screen.getByText('Cave'))
    // Begin a drag, then drop the dragged item onto another resource's wrapper.
    fireEvent.click(screen.getByText('drag-r1'))
    // Each ResourceRow is wrapped in a div with onDrop; drop onto the Battle row.
    const battleWrapper = screen.getByText('Battle').closest('div').parentElement
    fireEvent.dragOver(battleWrapper)
    fireEvent.drop(battleWrapper)
    await waitFor(() => expect(campaigns.reorderResources).toHaveBeenCalled())
  })
})
