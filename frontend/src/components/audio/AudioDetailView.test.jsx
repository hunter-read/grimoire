import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AudioDetailView from './AudioDetailView'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
  mediaUrl: (p) => `http://localhost${p}`,
}))

let locationState = null
const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useParams: () => ({ audioId: 'a1' }),
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: '/audio/a1', state: locationState }),
}))

// AudioPlayer is a context controller; stub it to a button so we don't need the provider.
vi.mock('./AudioPlayer', () => ({
  default: () => <button>play</button>,
}))
vi.mock('../campaigns/AddToCampaignButton', () => ({ default: () => null }))
// Stub the tag editor to immediately save, so the save-tag handlers run.
vi.mock('../maps/InlineTagEditor', () => ({
  default: ({ onSave }) => (
    <button onClick={() => onSave(['new'])} data-testid="save-tags">
      save
    </button>
  ),
}))
// TagSection exposes an Edit button via onEdit.
vi.mock('../TagSection', () => ({
  default: ({ label, onEdit }) => <button onClick={onEdit}>{`edit-${label}`}</button>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  locationState = null
})

const detail = (over = {}) => ({
  id: 'a1',
  filename: 'tavern.mp3',
  title: 'Tavern Night',
  artist: 'Bardcore',
  album: 'Inn',
  duration: 125,
  file_size: 2048,
  has_artwork: true,
  relative_path: 'audio/Ambient/tavern.mp3',
  tags: ['ambient'],
  folder_tags: ['cozy'],
  folder_path: 'Ambient',
  ...over,
})

describe('AudioDetailView', () => {
  it('shows a spinner before the track loads', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    render(<AudioDetailView />)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  // Issue #361: guests open tracks from a campaign and have no /audio route.
  it('returns to the referring path when one was passed in navigation state', async () => {
    locationState = { from: '/campaigns/c1/resources' }
    api.get.mockResolvedValue(detail())
    render(<AudioDetailView />)
    await waitFor(() => expect(screen.getByText('Bardcore')).toBeInTheDocument())
    await userEvent.click(screen.getByLabelText('Back to audio'))
    expect(navigate).toHaveBeenCalledWith('/campaigns/c1/resources')
  })

  it('falls back to the audio list when there is no referring path', async () => {
    api.get.mockResolvedValue(detail())
    render(<AudioDetailView />)
    await waitFor(() => expect(screen.getByText('Bardcore')).toBeInTheDocument())
    await userEvent.click(screen.getByLabelText('Back to audio'))
    expect(navigate).toHaveBeenCalledWith('/audio')
  })

  it('renders track metadata once loaded', async () => {
    api.get.mockResolvedValue(detail())
    render(<AudioDetailView />)
    await waitFor(() => expect(screen.getByText('Bardcore')).toBeInTheDocument())
    expect(screen.getByText('Inn')).toBeInTheDocument()
    // duration 125s -> 2:05
    expect(screen.getByText('2:05')).toBeInTheDocument()
    // play control (stubbed)
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
  })

  it('renders the music placeholder when no artwork', async () => {
    api.get.mockResolvedValue(detail({ has_artwork: false }))
    const { container } = render(<AudioDetailView />)
    // Title appears in the toolbar and the metadata row.
    await waitFor(() => expect(screen.getAllByText('Tavern Night').length).toBeGreaterThan(0))
    // No artwork image rendered.
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders the archive placeholder (no player) for an audio archive', async () => {
    api.get.mockResolvedValue(
      detail({
        filename: 'ambience.zip',
        title: '',
        artist: '',
        album: '',
        duration: 0,
        has_artwork: false,
        is_archive: true,
      })
    )
    render(<AudioDetailView />)
    await waitFor(() => expect(screen.getByText(/cannot be previewed/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /play/i })).toBeNull()
  })

  it('saves edited track tags', async () => {
    api.get.mockResolvedValue(detail())
    api.patch.mockResolvedValue({})
    render(<AudioDetailView />)
    await waitFor(() => screen.getByText('edit-Track Tags'))
    await userEvent.click(screen.getByText('edit-Track Tags'))
    await userEvent.click(screen.getByTestId('save-tags'))
    expect(api.patch).toHaveBeenCalledWith('/audio/a1', { tags: ['new'] })
  })

  it('saves edited folder tags', async () => {
    api.get.mockResolvedValue(detail())
    api.patch.mockResolvedValue({})
    render(<AudioDetailView />)
    await waitFor(() => screen.getByText('edit-Folder Tags'))
    await userEvent.click(screen.getByText('edit-Folder Tags'))
    await userEvent.click(screen.getByTestId('save-tags'))
    expect(api.patch).toHaveBeenCalledWith('/audio-folders', { path: 'Ambient', tags: ['new'] })
  })
})
