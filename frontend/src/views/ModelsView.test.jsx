import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ModelsView from './ModelsView'
import api from '../api'

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(() => Promise.resolve({})),
    post: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  tags: { list: vi.fn(() => Promise.resolve({ tags: [] })) },
  mediaUrl: (path) => `http://localhost${path}`,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../hooks/useUserPrefs', () => ({
  getUserPrefs: () => ({ cardSize: 'comfortable', librarySort: 'az' }),
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'admin' } }),
}))

const mockIsFavorite = vi.fn(() => false)
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite, toggleFavorite: vi.fn() }),
}))

vi.mock('../components/DownloadArchiveModal', () => ({
  default: ({ title, onClose }) => (
    <div data-testid="download-modal">
      <span data-testid="dl-title">{title}</span>
      <button onClick={onClose}>close dl</button>
    </div>
  ),
}))

// The bulk modals are exercised as mount/unmount wiring here; their own
// behaviour is covered by their component tests.
vi.mock('../components/AddToCampaignModal', () => ({
  default: ({ items, onClose, onAdded }) => (
    <div data-testid="add-to-campaign">
      <span data-testid="atc-count">{items.length}</span>
      <span data-testid="atc-payload">{items.map((i) => i.resource_id).join(',')}</span>
      <button onClick={onClose}>close atc</button>
      <button onClick={onAdded}>confirm atc</button>
    </div>
  ),
}))

vi.mock('../components/BulkEditModal', () => ({
  default: ({ type, items, onClose, onSaved }) => (
    <div data-testid="bulk-edit">
      <span data-testid="be-type">{type}</span>
      <span data-testid="be-count">{items.length}</span>
      <button onClick={onClose}>close be</button>
      {/* applyEdits takes a map of id → patch, not an array. */}
      <button onClick={() => onSaved({ t1: { filename: 'renamed.png' } })}>confirm be</button>
    </div>
  ),
}))

// LazyGrid uses IntersectionObserver which jsdom doesn't provide — render children directly.
vi.mock('../components/LazyGrid', () => ({
  default: ({ children }) => <>{children}</>,
}))

// Keep every folder expanded so filenames are immediately visible: the
// collapsed-set key is pinned to an empty Set and ignores writes, which is what
// the old all-mocked version achieved for every key at once.
//
// Everything else — notably the session-backed sort/filter state — gets real
// state, since a no-op setter there would silently swallow the filter changes
// these tests make.
vi.mock('../hooks/useSessionState', () => ({
  default: (_key, init) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [val, setVal] = useState(init)
    return init instanceof Set ? [new Set(), () => {}] : [val, setVal]
  },
}))

function makeModel(overrides = {}) {
  const id = overrides.id ?? `tok-${Math.random().toString(36).slice(2)}`
  return {
    id,
    filename: overrides.filename ?? `model-${id}.png`,
    relative_path: overrides.relative_path ?? `models/${overrides.filename ?? `model-${id}.png`}`,
    filepath: `/tmp/${id}.png`,
    tags: overrides.tags ?? [],
    has_thumbnail: false,
    is_missing: false,
    is_explicit: false,
    ...overrides,
  }
}

function makeModelsResponse(models = []) {
  return { models, total: models.length }
}

function renderView() {
  return render(
    <MemoryRouter>
      <ModelsView />
    </MemoryRouter>
  )
}

// Favorites is now a checkbox inside the Filters modal (no toolbar button).
async function toggleFavoritesFilter() {
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  await userEvent.click(screen.getByRole('checkbox', { name: /favorites/i }))
  await userEvent.click(screen.getByRole('button', { name: /done/i }))
}

describe('ModelsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
  })

  function setupModels(models) {
    api.get.mockImplementation((url) => {
      if (url.split('?')[0] === '/models') return Promise.resolve(makeModelsResponse(models))
      if (url === '/model-folders') return Promise.resolve({ folders: [] })
      return Promise.resolve({})
    })
  }

  it('renders model filenames after loading', async () => {
    setupModels([makeModel({ filename: 'goblin.png', relative_path: 'models/goblin.png' })])
    renderView()
    await waitFor(() => expect(screen.getByText('goblin.png')).toBeInTheDocument())
  })

  it('shows a spinner while loading', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    renderView()
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('exposes a favorites filter in the Filters modal', async () => {
    setupModels([makeModel({ filename: 'orc.png', relative_path: 'models/orc.png' })])
    renderView()
    await waitFor(() => expect(screen.getByText('orc.png')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    expect(screen.getByRole('checkbox', { name: /favorites/i })).toBeInTheDocument()
  })

  it('favorites filter hides non-favorite models', async () => {
    const favModel = makeModel({
      id: 'fav-tok',
      filename: 'fav.png',
      relative_path: 'models/fav.png',
    })
    const otherModel = makeModel({
      id: 'other-tok',
      filename: 'other.png',
      relative_path: 'models/other.png',
    })
    setupModels([favModel, otherModel])
    mockIsFavorite.mockImplementation((type, id) => type === 'model' && id === 'fav-tok')

    renderView()
    await waitFor(() => expect(screen.getByText('fav.png')).toBeInTheDocument())

    await toggleFavoritesFilter()

    expect(screen.getByText('fav.png')).toBeInTheDocument()
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()
  })

  it('toggling favorites off restores all models', async () => {
    const favModel = makeModel({
      id: 'fav-tok',
      filename: 'fav.png',
      relative_path: 'models/fav.png',
    })
    const otherModel = makeModel({
      id: 'other-tok',
      filename: 'other.png',
      relative_path: 'models/other.png',
    })
    setupModels([favModel, otherModel])
    mockIsFavorite.mockImplementation((type, id) => type === 'model' && id === 'fav-tok')

    renderView()
    await waitFor(() => expect(screen.getByText('other.png')).toBeInTheDocument())

    await toggleFavoritesFilter()
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()

    await toggleFavoritesFilter()
    expect(screen.getByText('other.png')).toBeInTheDocument()
  })

  it('shows favorites empty hint when filter is on and nothing matches', async () => {
    setupModels([makeModel({ filename: 'unfav.png', relative_path: 'models/unfav.png' })])
    mockIsFavorite.mockReturnValue(false)

    renderView()
    await waitFor(() => expect(screen.getByText('unfav.png')).toBeInTheDocument())

    await toggleFavoritesFilter()
    expect(screen.getByText(/no favorites here yet/i)).toBeInTheDocument()
  })

  // Bulk mode: selecting models and opening the two bulk modals the view owns.
  describe('bulk actions', () => {
    async function enterBulkAndSelect(filename) {
      await userEvent.click(screen.getByRole('button', { name: /^select$/i }))
      await userEvent.click(screen.getByText(filename))
    }

    async function setupOneModel() {
      setupModels([
        makeModel({ id: 't1', filename: 'goblin.png', relative_path: 'models/goblin.png' }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('goblin.png')).toBeInTheDocument())
      await enterBulkAndSelect('goblin.png')
    }

    it('opens the add-to-campaign modal with the selected models', async () => {
      await setupOneModel()
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))

      expect(screen.getByTestId('atc-count')).toHaveTextContent('1')
      expect(screen.getByTestId('atc-payload')).toHaveTextContent('t1')
    })

    it('closes the add-to-campaign modal', async () => {
      await setupOneModel()
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))
      await userEvent.click(screen.getByRole('button', { name: 'close atc' }))

      expect(screen.queryByTestId('add-to-campaign')).not.toBeInTheDocument()
    })

    // Issue #256: the modal closes but bulk mode and the selection stay up, so
    // the same batch can be sent to another campaign without re-picking it.
    it('keeps bulk mode once models are added to a campaign', async () => {
      await setupOneModel()
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))
      await userEvent.click(screen.getByRole('button', { name: 'confirm atc' }))

      expect(screen.queryByTestId('add-to-campaign')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument()
      expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    })

    it('opens the bulk edit modal for the model type', async () => {
      await setupOneModel()
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))

      expect(screen.getByTestId('be-type')).toHaveTextContent('model')
      expect(screen.getByTestId('be-count')).toHaveTextContent('1')
    })

    it('closes the bulk edit modal', async () => {
      await setupOneModel()
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))
      await userEvent.click(screen.getByRole('button', { name: 'close be' }))

      expect(screen.queryByTestId('bulk-edit')).not.toBeInTheDocument()
    })

    it('applies bulk edits and exits bulk mode on save', async () => {
      await setupOneModel()
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))
      await userEvent.click(screen.getByRole('button', { name: 'confirm be' }))

      expect(screen.queryByTestId('bulk-edit')).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByText('renamed.png')).toBeInTheDocument())
    })
  })

  it('text filter and favorites filter compose correctly', async () => {
    const favModel = makeModel({
      id: 'fav-tok',
      filename: 'dragon.png',
      relative_path: 'models/dragon.png',
    })
    const otherFav = makeModel({
      id: 'other-fav',
      filename: 'drake.png',
      relative_path: 'models/drake.png',
    })
    const nonFav = makeModel({
      id: 'non-fav',
      filename: 'goblin.png',
      relative_path: 'models/goblin.png',
    })
    setupModels([favModel, otherFav, nonFav])
    mockIsFavorite.mockImplementation((type, id) => ['fav-tok', 'other-fav'].includes(id))

    renderView()
    await waitFor(() => expect(screen.getByText('goblin.png')).toBeInTheDocument())

    // Enable favorites filter — goblin.png should vanish
    await toggleFavoritesFilter()
    expect(screen.queryByText('goblin.png')).not.toBeInTheDocument()

    // The text search now lives in a standalone search box outside the modal.
    await userEvent.type(screen.getByPlaceholderText(/filter models/i), 'dragon')
    await waitFor(() => expect(screen.queryByText('drake.png')).not.toBeInTheDocument())
    expect(screen.getByText('dragon.png')).toBeInTheDocument()
  })

  describe('support badges', () => {
    // The presupported/unsupported pair is the distinction a 3D-print library
    // is organised around, and it arrives as two booleans rather than one
    // tri-state field precisely so an unknown model claims neither.
    const withSupport = [
      makeModel({ id: 'm1', filename: 'pre.stl', is_presupported: true, is_unsupported: false }),
      makeModel({ id: 'm2', filename: 'un.stl', is_presupported: false, is_unsupported: true }),
      makeModel({
        id: 'm3',
        filename: 'unknown.stl',
        is_presupported: false,
        is_unsupported: false,
      }),
    ]

    it('labels a presupported model', async () => {
      setupModels(withSupport)
      renderView()
      expect(await screen.findByText('pre.stl')).toBeInTheDocument()
      expect(screen.getByText(/presupported/i)).toBeInTheDocument()
    })

    it('labels an unsupported model', async () => {
      setupModels(withSupport)
      renderView()
      expect(await screen.findByText('un.stl')).toBeInTheDocument()
      expect(screen.getByText(/^unsupported$/i)).toBeInTheDocument()
    })

    it('claims nothing for a model whose support state is unknown', async () => {
      setupModels([withSupport[2]])
      renderView()
      expect(await screen.findByText('unknown.stl')).toBeInTheDocument()
      expect(screen.queryByText(/presupported/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/^unsupported$/i)).not.toBeInTheDocument()
    })
  })
})
