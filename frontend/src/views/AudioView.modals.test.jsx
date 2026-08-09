import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AudioView from './AudioView'

// Drive the three modal branches by mocking GalleryLayout to expose its callbacks.
vi.mock('../components/media/GalleryLayout', () => ({
  default: ({ onDownload, onAddToCampaign, onBulkEdit }) => (
    <div>
      <button onClick={() => onDownload({ title: 'T', params: {} })}>fire-download</button>
      <button onClick={onAddToCampaign}>fire-campaign</button>
      <button onClick={onBulkEdit}>fire-bulk</button>
    </div>
  ),
}))

const selectedObjects = vi.fn(() => [{ id: 'a1' }, { id: 'a2' }])
const bulkExit = vi.fn()
vi.mock('../hooks/useMediaGallery', () => ({
  default: () => ({
    data: { total: 2 },
    selectedObjects,
    applyEdits: vi.fn(),
    bulk: { exit: bulkExit },
  }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' } }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

vi.mock('../components/DownloadArchiveModal', () => ({
  default: ({ onClose }) => (
    <div data-testid="dl-modal">
      <button onClick={onClose}>x</button>
    </div>
  ),
}))
vi.mock('../components/AddToCampaignModal', () => ({
  default: ({ items, onAdded }) => (
    <div data-testid="campaign-modal">
      {items.map((i) => i.resource_type + ':' + i.resource_id).join(',')}
      <button onClick={onAdded}>x</button>
    </div>
  ),
}))
vi.mock('../components/BulkEditModal', () => ({
  default: ({ type, onClose, onSaved }) => (
    <div data-testid="bulk-modal">
      {type}
      <button onClick={() => onSaved({ a1: { tags: ['x'] } })}>save-bulk</button>
      <button onClick={onClose}>close-bulk</button>
    </div>
  ),
}))

beforeEach(() => vi.clearAllMocks())

describe('AudioView modals', () => {
  it('opens and closes the download modal', async () => {
    render(<AudioView />)
    await userEvent.click(screen.getByText('fire-download'))
    expect(screen.getByTestId('dl-modal')).toBeInTheDocument()
    await userEvent.click(screen.getByText('x'))
    expect(screen.queryByTestId('dl-modal')).not.toBeInTheDocument()
  })

  it('opens the add-to-campaign modal with audio resource items', async () => {
    render(<AudioView />)
    await userEvent.click(screen.getByText('fire-campaign'))
    const modal = screen.getByTestId('campaign-modal')
    expect(modal).toHaveTextContent('audio:a1')
    expect(modal).toHaveTextContent('audio:a2')
    await userEvent.click(screen.getByText('x'))
    expect(bulkExit).toHaveBeenCalled()
  })

  it('opens the bulk-edit modal with type=audio and saves edits', async () => {
    render(<AudioView />)
    await userEvent.click(screen.getByText('fire-bulk'))
    expect(screen.getByTestId('bulk-modal')).toHaveTextContent('audio')
    await userEvent.click(screen.getByText('save-bulk'))
    expect(bulkExit).toHaveBeenCalled()
  })

  // onSelectItem is removed; navigation to the track detail page is now handled
  // by real CardLink anchors inside each MediaCard (native browser navigation).
})
