import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TokenDetailView from './TokenDetailView'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
  mediaUrl: (p) => `http://localhost${p}`,
}))

let currentTokenId = 't2'
let locationState = null
const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useParams: () => ({ tokenId: currentTokenId }),
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: `/tokens/${currentTokenId}`, state: locationState }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'gm' } }),
}))

vi.mock('../campaigns/AddToCampaignButton', () => ({ default: () => null }))
vi.mock('../maps/InlineTagEditor', () => ({
  default: ({ onSave }) => (
    <button onClick={() => onSave(['new'])} data-testid="save-tags">
      save
    </button>
  ),
}))
vi.mock('../TagSection', () => ({
  default: ({ label, onEdit }) => <button onClick={onEdit}>{`edit-${label}`}</button>,
}))

// Three tokens in the same folder, sorted by filename: t1, t2, t3.
const SIBLINGS = [
  { id: 't1', filename: 'a.png', relative_path: 'DnD/Goblins/a.png' },
  { id: 't2', filename: 'b.png', relative_path: 'DnD/Goblins/b.png' },
  { id: 't3', filename: 'c.png', relative_path: 'DnD/Goblins/c.png' },
]

const detail = (id, over = {}) => ({
  id,
  filename: `${id}.png`,
  relative_path: `DnD/Goblins/${id}.png`,
  file_size: 1024,
  tags: ['goblin'],
  folder_tags: ['green'],
  folder_path: 'Goblins',
  is_explicit: false,
  ...over,
})

// Route api.get by URL: the full token list vs a single token fetch.
const mockApi = (currentId, over = {}) => {
  api.get.mockImplementation((url) => {
    if (url === '/tokens') return Promise.resolve(SIBLINGS)
    return Promise.resolve(detail(currentId, over))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  currentTokenId = 't2'
  locationState = null
})

describe('TokenDetailView', () => {
  it('shows a spinner before the token loads', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    render(<TokenDetailView />)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('renders token metadata once loaded', async () => {
    mockApi('t2')
    render(<TokenDetailView />)
    await waitFor(() => expect(screen.getByText('t2.png')).toBeInTheDocument())
    expect(screen.getByText('Goblins')).toBeInTheDocument()
  })

  // Issue #361: guests open tokens from a campaign and have no /tokens route.
  it('returns to the referring path when one was passed in navigation state', async () => {
    locationState = { from: '/campaigns/c1/resources' }
    mockApi('t2')
    render(<TokenDetailView />)
    await waitFor(() => expect(screen.getByText('t2.png')).toBeInTheDocument())
    await userEvent.click(screen.getByLabelText('Back to tokens'))
    expect(navigate).toHaveBeenCalledWith('/campaigns/c1/resources', {
      state: { restoreView: true },
    })
  })

  it('falls back to the tokens list when there is no referring path', async () => {
    mockApi('t2')
    render(<TokenDetailView />)
    await waitFor(() => expect(screen.getByText('t2.png')).toBeInTheDocument())
    await userEvent.click(screen.getByLabelText('Back to tokens'))
    expect(navigate).toHaveBeenCalledWith('/tokens', { state: { restoreView: true } })
  })

  it('renders the archive placeholder instead of an <img> for an archive token', async () => {
    mockApi('t2', { filename: 'portraits.zip', is_archive: true })
    render(<TokenDetailView />)
    await waitFor(() => expect(screen.getByText(/cannot be previewed/i)).toBeInTheDocument())
    expect(document.querySelector('img')).toBeNull()
  })

  it('navigates to the next token with the right arrow key', async () => {
    mockApi('t2')
    render(<TokenDetailView />)
    await screen.findByText('t2.png')
    // Siblings load via a separate /tokens request; retry the key until the
    // handler sees the loaded list (avoids a race under parallel test load).
    await waitFor(async () => {
      await userEvent.keyboard('{ArrowRight}')
      expect(navigate).toHaveBeenCalledWith('/tokens/t3')
    })
  })

  it('navigates to the previous token with the left arrow key', async () => {
    mockApi('t2')
    render(<TokenDetailView />)
    await screen.findByText('t2.png')
    await waitFor(async () => {
      await userEvent.keyboard('{ArrowLeft}')
      expect(navigate).toHaveBeenCalledWith('/tokens/t1')
    })
  })

  it('saves edited token tags', async () => {
    mockApi('t2')
    api.patch.mockResolvedValue({})
    render(<TokenDetailView />)
    await waitFor(() => screen.getByText('edit-Token Tags'))
    await userEvent.click(screen.getByText('edit-Token Tags'))
    await userEvent.click(screen.getByTestId('save-tags'))
    expect(api.patch).toHaveBeenCalledWith('/tokens/t2', { tags: ['new'] })
  })

  it('saves edited folder tags', async () => {
    mockApi('t2')
    api.patch.mockResolvedValue({})
    render(<TokenDetailView />)
    await waitFor(() => screen.getByText('edit-Folder Tags'))
    await userEvent.click(screen.getByText('edit-Folder Tags'))
    await userEvent.click(screen.getByTestId('save-tags'))
    expect(api.patch).toHaveBeenCalledWith('/token-folders', { path: 'Goblins', tags: ['new'] })
  })

  it('toggles the explicit flag for editors', async () => {
    mockApi('t2')
    api.patch.mockResolvedValue({})
    render(<TokenDetailView />)
    const checkbox = await screen.findByRole('checkbox')
    await userEvent.click(checkbox)
    expect(api.patch).toHaveBeenCalledWith('/tokens/t2', { is_explicit: true })
  })
})
