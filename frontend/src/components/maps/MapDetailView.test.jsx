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
let locationState = null
const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useParams: () => ({ mapId: currentMapId }),
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: `/maps/${currentMapId}`, state: locationState }),
}))

const toggleFavorite = vi.fn()
vi.mock('../campaigns/AddToCampaignButton', () => ({ default: () => null }))
vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite }),
}))
vi.mock('./MapGridEditor', () => ({
  default: ({ onSaved }) => (
    <button onClick={onSaved} data-testid="grid-saved">
      grid-editor
    </button>
  ),
}))
vi.mock('../DownloadVersionButton', () => ({
  default: ({ extraItems = [] }) => (
    <div data-testid="download-extras">{extraItems.map((e) => e.href).join(',')}</div>
  ),
}))
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
vi.mock('./MapImagePane', () => ({
  default: ({ mapId }) => <div data-testid="image-pane">{`image:${mapId}`}</div>,
}))
vi.mock('./MapVideoPane', () => ({
  default: ({ mapId }) => <div data-testid="video-pane">{`video:${mapId}`}</div>,
}))
vi.mock('./MapVttPane', () => ({
  default: ({ mapId, onData }) => (
    <div data-testid="vtt-pane">
      {`vtt:${mapId}`}
      <button
        data-testid="emit-vtt"
        onClick={() =>
          onData({
            grid_width: 20,
            grid_height: 16,
            pixels_per_grid: 100,
            wall_count: 10,
            object_wall_count: 2,
            portal_count: 3,
            light_count: 4,
          })
        }
      >
        emit
      </button>
    </div>
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
  locationState = null
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

  // Issue #361: guests open maps from a campaign and have no /maps route.
  it('returns to the referring path when one was passed in navigation state', async () => {
    locationState = { from: '/campaigns/c1/resources' }
    mockApi('m2')
    render(<MapDetailView />)
    await waitFor(() => expect(screen.getByText('m2.png')).toBeInTheDocument())
    await userEvent.click(screen.getByLabelText('Back to maps'))
    expect(navigate).toHaveBeenCalledWith('/campaigns/c1/resources', {
      state: { restoreView: true },
    })
  })

  it('falls back to the maps list when there is no referring path', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    await waitFor(() => expect(screen.getByText('m2.png')).toBeInTheDocument())
    await userEvent.click(screen.getByLabelText('Back to maps'))
    expect(navigate).toHaveBeenCalledWith('/maps', { state: { restoreView: true } })
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

  it('renders the image pane (not the PDF viewer) for a raster map', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    await waitFor(() => expect(screen.getByText('m2.png')).toBeInTheDocument())
    expect(screen.queryByTestId('pdf-viewer')).toBeNull()
    expect(screen.getByTestId('image-pane')).toBeInTheDocument()
  })

  it('renders the archive placeholder (no viewer) for an archive map', async () => {
    mockApi('m2', { filename: 'pack.zip', is_archive: true })
    render(<MapDetailView />)
    await waitFor(() => expect(screen.getByText(/cannot be previewed/i)).toBeInTheDocument())
    expect(screen.queryByTestId('pdf-viewer')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
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

  // Issue: viewer support for animated maps and Universal VTT files.
  describe('format routing', () => {
    it('mounts the image pane for a raster map', async () => {
      mockApi('m2', { media_kind: 'image' })
      render(<MapDetailView />)
      await waitFor(() => expect(screen.getByTestId('image-pane')).toBeInTheDocument())
    })

    it('mounts the video pane for an animated map', async () => {
      mockApi('m2', { media_kind: 'video', filename: 'storm.webm' })
      render(<MapDetailView />)
      await waitFor(() => expect(screen.getByTestId('video-pane')).toBeInTheDocument())
      expect(screen.queryByTestId('image-pane')).toBeNull()
    })

    it('mounts the VTT pane and shows its wall/portal/light counts', async () => {
      mockApi('m2', { media_kind: 'vtt', filename: 'tavern.uvtt' })
      render(<MapDetailView />)
      await waitFor(() => expect(screen.getByTestId('vtt-pane')).toBeInTheDocument())

      await userEvent.click(screen.getByTestId('emit-vtt'))

      // Walls are the sum of line_of_sight and objects_line_of_sight.
      await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument())
      expect(screen.getByText('3')).toBeInTheDocument()
      expect(screen.getByText('4')).toBeInTheDocument()
    })

    it('prefers the PDF viewer over the image pane for a PDF map', async () => {
      mockApi('m2', { is_pdf: true, page_count: 3 })
      render(<MapDetailView />)
      await waitFor(() => expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument())
      expect(screen.queryByTestId('image-pane')).toBeNull()
    })
  })

  describe('grid editing', () => {
    it('opens the editor and reloads the map after a save', async () => {
      mockApi('m2', { grid: { width: 10, height: 14, cell_px: 140, source: 'computed' } })
      render(<MapDetailView />)
      await screen.findByTestId('image-pane')

      await userEvent.click(screen.getByTestId('open-grid-editor'))
      const before = api.get.mock.calls.length
      await userEvent.click(screen.getByTestId('grid-saved'))
      // The resolved grid only exists server-side, so a save re-fetches rather
      // than patching local state.
      await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(before))
    })

    it('offers the editor for a map with no detected grid', async () => {
      mockApi('m2', { grid: null })
      render(<MapDetailView />)
      await screen.findByTestId('image-pane')
      expect(screen.getByTestId('open-grid-editor')).toBeInTheDocument()
    })

    it('offers no grid editing or UVTT export for a PDF map', async () => {
      mockApi('m2', { is_pdf: true, page_count: 3, grid: null })
      render(<MapDetailView />)
      await screen.findByTestId('pdf-viewer')
      expect(screen.queryByTestId('open-grid-editor')).toBeNull()
      expect(screen.queryByText(/export.uvtt/)).toBeNull()
    })

    it('offers no UVTT export when a linked Universal VTT already exists', async () => {
      // Linked through the duplicate manager, so the filename says nothing —
      // the `kind` on the variant link is what marks it.
      mockApi('m2', {
        grid: { width: 10, height: 14, cell_px: 140, source: 'computed' },
        variants: [{ id: 'v1', kind: 'universal-vtt', filename: 'anything-at-all.dat' }],
      })
      render(<MapDetailView />)
      await screen.findByTestId('image-pane')
      expect(screen.getByTestId('download-extras')).toHaveTextContent('')
      // The grid is still editable — correcting it is worth doing regardless.
      expect(screen.getByTestId('open-grid-editor')).toBeInTheDocument()
    })

    it('detects an uncategorised link by its extension', async () => {
      mockApi('m2', {
        grid: { width: 10, height: 14, cell_px: 140, source: 'computed' },
        variants: [{ id: 'v1', kind: '', filename: 'tavern.dd2vtt' }],
      })
      render(<MapDetailView />)
      await screen.findByTestId('image-pane')
      expect(screen.getByTestId('download-extras')).toHaveTextContent('')
    })

    it('still offers the export for an unrelated variant', async () => {
      mockApi('m2', {
        grid: { width: 10, height: 14, cell_px: 140, source: 'computed' },
        variants: [{ id: 'v1', kind: 'gridless', filename: 'b-gridless.png' }],
      })
      render(<MapDetailView />)
      await screen.findByTestId('image-pane')
      expect(screen.getByTestId('download-extras')).toHaveTextContent('/maps/m2/export.uvtt')
    })

    it('offers the UVTT export for a raster map', async () => {
      mockApi('m2', { grid: { width: 10, height: 14, cell_px: 140, source: 'computed' } })
      render(<MapDetailView />)
      await screen.findByTestId('image-pane')
      expect(screen.getByTestId('download-extras')).toHaveTextContent('/maps/m2/export.uvtt')
    })
  })

  it('favourites the map from its detail toolbar', async () => {
    mockApi('m2')
    render(<MapDetailView />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add to favorites' }))
    expect(toggleFavorite).toHaveBeenCalledWith('map', 'm2')
  })
})
