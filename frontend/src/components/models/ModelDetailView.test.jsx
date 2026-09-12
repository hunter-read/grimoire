import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ModelDetailView from './ModelDetailView'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), patch: vi.fn(() => Promise.resolve({})) },
  mediaUrl: (p) => `http://localhost${p}`,
  tags: { list: vi.fn(() => Promise.resolve({ tags: [] })) },
}))

// The viewer is covered by its own suite; stub it so this file tests the page.
vi.mock('./ModelViewerPane', () => ({
  default: ({ model }) => <div data-testid="viewer">{model.filename}</div>,
}))

const toggleFavorite = vi.fn()
vi.mock('../campaigns/AddToCampaignButton', () => ({ default: () => null }))
vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite }),
}))
vi.mock('../DownloadVersionButton', () => ({ default: () => null }))
vi.mock('../VariantPicker', () => ({ default: () => null }))
vi.mock('../maps/InlineTagEditor', () => ({
  default: () => <div data-testid="tag-editor" />,
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigate }
})

let isMobile = false
vi.mock('../../hooks/useIsMobile', () => ({ default: () => isMobile }))

let role = 'admin'
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role } }) }))

const aModel = (over = {}) => ({
  id: 'm1',
  filename: 'goblin-archer.stl',
  relative_path: 'models/Goblins/goblin-archer.stl',
  folder_path: 'Goblins',
  folder_tags: [],
  tags: ['goblin'],
  file_size: 5 * 1048576,
  triangle_count: 12480,
  is_supported: true,
  is_explicit: false,
  is_missing: false,
  is_archive: false,
  viewer_loader: 'stl',
  viewer_available: true,
  variants: [],
  ...over,
})

function renderAt(model) {
  api.get.mockResolvedValue(model)
  return render(
    <MemoryRouter initialEntries={['/models/m1']}>
      <Routes>
        <Route path="/models/:modelId" element={<ModelDetailView />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ModelDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    role = 'admin'
    isMobile = false
  })

  it('renders the filename and the viewer', async () => {
    renderAt(aModel())
    expect(await screen.findByTestId('viewer')).toHaveTextContent('goblin-archer.stl')
  })

  it('shows the triangle count formatted', async () => {
    renderAt(aModel())
    expect(await screen.findByText('12,480')).toBeInTheDocument()
  })

  it('hides the triangle count when unknown', async () => {
    // 0 means "not a binary STL", not "an empty mesh" — showing it would read
    // as a real measurement.
    renderAt(aModel({ triangle_count: 0 }))
    await screen.findByTestId('viewer')
    expect(screen.queryByText('Triangles')).not.toBeInTheDocument()
  })

  it('shows the support state', async () => {
    renderAt(aModel())
    expect(await screen.findByText('Presupported')).toBeInTheDocument()
  })

  it('shows unknown support state', async () => {
    renderAt(aModel({ is_supported: null }))
    expect(await screen.findByText('Unknown')).toBeInTheDocument()
  })

  it('cycles the support state unknown → presupported', async () => {
    renderAt(aModel({ is_supported: null }))
    await userEvent.click(await screen.findByText('Unknown'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/models/m1', { is_supported: true })
    )
  })

  it('cycles presupported → unsupported', async () => {
    renderAt(aModel({ is_supported: true }))
    await userEvent.click(await screen.findByText('Presupported'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/models/m1', { is_supported: false })
    )
  })

  it('cycles unsupported back to unknown', async () => {
    renderAt(aModel({ is_supported: false }))
    await userEvent.click(await screen.findByText('Unsupported'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/models/m1', { is_supported: null })
    )
  })

  it('does not offer the support toggle to a player', async () => {
    role = 'player'
    renderAt(aModel())
    await screen.findByTestId('viewer')
    expect(screen.getByText('Presupported').tagName).not.toBe('BUTTON')
  })

  it('renders model tags', async () => {
    renderAt(aModel())
    expect(await screen.findByText('goblin')).toBeInTheDocument()
  })

  it('shows the archive placeholder instead of a viewer for an archive', async () => {
    renderAt(aModel({ is_archive: true, filename: 'pack.zip' }))
    await waitFor(() => expect(screen.queryByTestId('viewer')).not.toBeInTheDocument())
  })

  it('shows a spinner until the model loads', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    render(
      <MemoryRouter initialEntries={['/models/m1']}>
        <Routes>
          <Route path="/models/:modelId" element={<ModelDetailView />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.queryByTestId('viewer')).not.toBeInTheDocument()
  })

  it('saves edited model tags', async () => {
    renderAt(aModel())
    await screen.findByTestId('viewer')
    const editButtons = screen.getAllByText('Edit')
    await userEvent.click(editButtons[editButtons.length - 1])
    expect(await screen.findByTestId('tag-editor')).toBeInTheDocument()
  })

  it('saves edited folder tags', async () => {
    renderAt(aModel())
    await screen.findByTestId('viewer')
    await userEvent.click(screen.getAllByText('Edit')[0])
    expect(await screen.findByTestId('tag-editor')).toBeInTheDocument()
  })

  it('toggles the explicit flag', async () => {
    renderAt(aModel())
    const box = await screen.findByLabelText('Explicit content')
    await userEvent.click(box)
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/models/m1', { is_explicit: true }))
  })

  it('hides the explicit toggle from a player', async () => {
    role = 'player'
    renderAt(aModel())
    await screen.findByTestId('viewer')
    expect(screen.queryByLabelText('Explicit content')).not.toBeInTheDocument()
  })

  it('shows the folder location', async () => {
    renderAt(aModel())
    expect(await screen.findByText('Goblins')).toBeInTheDocument()
  })

  it('navigates back to the gallery', async () => {
    renderAt(aModel())
    await userEvent.click(await screen.findByLabelText('Back to models'))
    expect(navigate).toHaveBeenCalledWith('/models', { state: { restoreView: true } })
  })

  describe('on a phone', () => {
    // The metadata sidebar becomes a toggle-controlled panel rather than a
    // permanent column, so the details it holds are hidden until asked for.
    it('hides the details panel until the toggle is pressed', async () => {
      isMobile = true
      renderAt(aModel())
      await screen.findByTestId('viewer')
      expect(screen.queryByText('12,480')).not.toBeVisible()
    })

    it('reveals the details panel when toggled', async () => {
      isMobile = true
      renderAt(aModel())
      await screen.findByTestId('viewer')
      await userEvent.click(screen.getByTitle('Details'))
      expect(screen.getByText('12,480')).toBeVisible()
    })
  })

  it('favourites the model from its detail toolbar', async () => {
    renderAt(aModel())
    await userEvent.click(await screen.findByRole('button', { name: 'Add to favorites' }))
    expect(toggleFavorite).toHaveBeenCalledWith('model', 'm1')
  })

  describe('sibling navigation', () => {
    const SIBLINGS = [
      { id: 'm0', filename: 'a.stl', relative_path: 'models/Goblins/a.stl' },
      {
        id: 'm1',
        filename: 'goblin-archer.stl',
        relative_path: 'models/Goblins/goblin-archer.stl',
      },
      { id: 'm2', filename: 'z.stl', relative_path: 'models/Goblins/z.stl' },
    ]

    // Route by URL: the folder list vs the model itself.
    const renderWithSiblings = (over = {}) => {
      api.get.mockImplementation((url) => {
        if (url.split('?')[0] === '/models')
          return Promise.resolve({ total: SIBLINGS.length, models: SIBLINGS })
        return Promise.resolve(aModel(over))
      })
      return render(
        <MemoryRouter initialEntries={['/models/m1']}>
          <Routes>
            <Route path="/models/:modelId" element={<ModelDetailView />} />
          </Routes>
        </MemoryRouter>
      )
    }

    it('shows the position of the model within its folder', async () => {
      renderWithSiblings()
      expect(await screen.findByText('2 / 3')).toBeInTheDocument()
    })

    it('steps to the next model with the arrow button', async () => {
      renderWithSiblings()
      await userEvent.click(await screen.findByRole('button', { name: 'Next model' }))
      expect(navigate).toHaveBeenCalledWith('/models/m2')
    })

    it('steps to the previous model with the arrow button', async () => {
      renderWithSiblings()
      await userEvent.click(await screen.findByRole('button', { name: 'Previous model' }))
      expect(navigate).toHaveBeenCalledWith('/models/m0')
    })

    it('steps with the arrow keys', async () => {
      renderWithSiblings()
      await screen.findByText('2 / 3')
      await userEvent.keyboard('{ArrowRight}')
      expect(navigate).toHaveBeenCalledWith('/models/m2')
      await userEvent.keyboard('{ArrowLeft}')
      expect(navigate).toHaveBeenCalledWith('/models/m0')
    })

    it('offers no navigation for an archive, which has no viewer pane', async () => {
      renderWithSiblings({ is_archive: true, filename: 'pack.zip' })
      await waitFor(() => expect(screen.queryByTestId('viewer')).not.toBeInTheDocument())
      expect(screen.queryByRole('button', { name: 'Next model' })).not.toBeInTheDocument()
    })
  })
})
