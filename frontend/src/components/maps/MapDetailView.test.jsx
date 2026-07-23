import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MapDetailView from './MapDetailView'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
  mediaUrl: (p) => `http://localhost${p}`,
}))

let currentMapId = 'm2'
const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useParams: () => ({ mapId: currentMapId }),
  useNavigate: () => navigate,
}))

vi.mock('../campaigns/AddToCampaignButton', () => ({ default: () => null }))
vi.mock('./InlineTagEditor', () => ({
  default: ({ onSave }) => (
    <button onClick={() => onSave(['new'])} data-testid="save-tags">
      save
    </button>
  ),
}))
vi.mock('../TagSection', () => ({
  default: ({ label, onEdit }) => <button onClick={onEdit}>{`edit-${label}`}</button>,
}))
vi.mock('./MapPdfViewer', () => ({
  default: ({ mapId, totalPages }) => (
    <div data-testid="pdf-viewer">{`pdf:${mapId}:${totalPages}`}</div>
  ),
}))

// Three maps in the same folder, sorted by filename: m1, m2, m3.
const SIBLINGS = [
  { id: 'm1', filename: 'a.png', relative_path: 'DnD/Dungeons/a.png' },
  { id: 'm2', filename: 'b.png', relative_path: 'DnD/Dungeons/b.png' },
  { id: 'm3', filename: 'c.png', relative_path: 'DnD/Dungeons/c.png' },
]

const detail = (id, over = {}) => ({
  id,
  filename: `${id}.png`,
  relative_path: `DnD/Dungeons/${id}.png`,
  file_size: 2048,
  tags: ['dungeon'],
  folder_tags: ['spooky'],
  folder_path: 'Dungeons',
  ...over,
})

// Route api.get by URL: the folder listing vs a single map fetch.
const mockApi = (currentId, over = {}) => {
  api.get.mockImplementation((url) => {
    if (url.startsWith('/maps?')) return Promise.resolve({ total: SIBLINGS.length, maps: SIBLINGS })
    return Promise.resolve(detail(currentId, over))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  currentMapId = 'm2'
})

describe('MapDetailView', () => {
  it('shows a spinner before the map loads', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    render(<MapDetailView />)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('renders map metadata once loaded', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    await waitFor(() => expect(screen.getByText('m2.png')).toBeInTheDocument())
    expect(screen.getByText('Dungeons')).toBeInTheDocument()
  })

  it('fetches siblings scoped to the folder', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/maps?folder=Dungeons'))
  })

  it('shows the position indicator for the current map', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeInTheDocument())
  })

  it('navigates to the next map when the next control is clicked', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    const next = await screen.findByRole('button', { name: /next map/i })
    await userEvent.click(next)
    expect(navigate).toHaveBeenCalledWith('/maps/m3')
  })

  it('navigates to the previous map when the prev control is clicked', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    const prev = await screen.findByRole('button', { name: /previous map/i })
    await userEvent.click(prev)
    expect(navigate).toHaveBeenCalledWith('/maps/m1')
  })

  it('hides the prev control on the first map', async () => {
    currentMapId = 'm1'
    mockApi('m1')
    render(<MapDetailView />)
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /previous map/i })).toBeNull()
    expect(screen.getByRole('button', { name: /next map/i })).toBeInTheDocument()
  })

  it('hides the next control on the last map', async () => {
    currentMapId = 'm3'
    mockApi('m3')
    render(<MapDetailView />)
    await waitFor(() => expect(screen.getByText('3 / 3')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /next map/i })).toBeNull()
    expect(screen.getByRole('button', { name: /previous map/i })).toBeInTheDocument()
  })

  it('navigates with the right/left arrow keys', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    await screen.findByText('2 / 3')
    await userEvent.keyboard('{ArrowRight}')
    expect(navigate).toHaveBeenCalledWith('/maps/m3')
    await userEvent.keyboard('{ArrowLeft}')
    expect(navigate).toHaveBeenCalledWith('/maps/m1')
  })

  it('renders the PDF viewer for a PDF map instead of an <img>', async () => {
    mockApi('m2', { filename: 'm2.pdf', is_pdf: true, page_count: 4 })
    render(<MapDetailView />)
    const viewer = await screen.findByTestId('pdf-viewer')
    expect(viewer).toHaveTextContent('pdf:m2:4')
    expect(document.querySelector('img')).toBeNull()
  })

  it('renders an <img> (not the PDF viewer) for a raster map', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    await waitFor(() => expect(screen.getByText('m2.png')).toBeInTheDocument())
    expect(screen.queryByTestId('pdf-viewer')).toBeNull()
    expect(document.querySelector('img')).toBeInTheDocument()
  })

  it('saves edited map tags', async () => {
    mockApi('m2')
    api.patch.mockResolvedValue({})
    render(<MapDetailView />)
    await waitFor(() => screen.getByText('edit-Map Tags'))
    await userEvent.click(screen.getByText('edit-Map Tags'))
    await userEvent.click(screen.getByTestId('save-tags'))
    expect(api.patch).toHaveBeenCalledWith('/maps/m2', { tags: ['new'] })
  })

  it('saves edited folder tags', async () => {
    mockApi('m2')
    api.patch.mockResolvedValue({})
    render(<MapDetailView />)
    await waitFor(() => screen.getByText('edit-Folder Tags'))
    await userEvent.click(screen.getByText('edit-Folder Tags'))
    await userEvent.click(screen.getByTestId('save-tags'))
    expect(api.patch).toHaveBeenCalledWith('/map-folders', { path: 'Dungeons', tags: ['new'] })
  })
})
