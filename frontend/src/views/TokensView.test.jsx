import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TokensView from './TokensView'
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

// Start all folders expanded so token filenames are immediately visible.
vi.mock('../hooks/useSessionState', () => ({
  default: (_key, _init) => [new Set(), vi.fn()],
}))

function makeToken(overrides = {}) {
  const id = overrides.id ?? `tok-${Math.random().toString(36).slice(2)}`
  return {
    id,
    filename: overrides.filename ?? `token-${id}.png`,
    relative_path: overrides.relative_path ?? `tokens/${overrides.filename ?? `token-${id}.png`}`,
    filepath: `/tmp/${id}.png`,
    tags: overrides.tags ?? [],
    has_thumbnail: false,
    is_missing: false,
    is_explicit: false,
    ...overrides,
  }
}

function makeTokensResponse(tokens = []) {
  return { tokens, total: tokens.length }
}

function renderView() {
  return render(
    <MemoryRouter>
      <TokensView />
    </MemoryRouter>
  )
}

// Favorites is now a checkbox inside the Filters modal (no toolbar button).
async function toggleFavoritesFilter() {
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  await userEvent.click(screen.getByRole('checkbox', { name: /favorites/i }))
  await userEvent.click(screen.getByRole('button', { name: /done/i }))
}

describe('TokensView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
  })

  function setupTokens(tokens) {
    api.get.mockImplementation((url) => {
      if (url === '/tokens') return Promise.resolve(makeTokensResponse(tokens))
      if (url === '/token-folders') return Promise.resolve({ folders: [] })
      return Promise.resolve({})
    })
  }

  it('renders token filenames after loading', async () => {
    setupTokens([makeToken({ filename: 'goblin.png', relative_path: 'tokens/goblin.png' })])
    renderView()
    await waitFor(() => expect(screen.getByText('goblin.png')).toBeInTheDocument())
  })

  it('shows a spinner while loading', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    renderView()
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('exposes a favorites filter in the Filters modal', async () => {
    setupTokens([makeToken({ filename: 'orc.png', relative_path: 'tokens/orc.png' })])
    renderView()
    await waitFor(() => expect(screen.getByText('orc.png')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    expect(screen.getByRole('checkbox', { name: /favorites/i })).toBeInTheDocument()
  })

  it('favorites filter hides non-favorite tokens', async () => {
    const favToken = makeToken({
      id: 'fav-tok',
      filename: 'fav.png',
      relative_path: 'tokens/fav.png',
    })
    const otherToken = makeToken({
      id: 'other-tok',
      filename: 'other.png',
      relative_path: 'tokens/other.png',
    })
    setupTokens([favToken, otherToken])
    mockIsFavorite.mockImplementation((type, id) => type === 'token' && id === 'fav-tok')

    renderView()
    await waitFor(() => expect(screen.getByText('fav.png')).toBeInTheDocument())

    await toggleFavoritesFilter()

    expect(screen.getByText('fav.png')).toBeInTheDocument()
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()
  })

  it('toggling favorites off restores all tokens', async () => {
    const favToken = makeToken({
      id: 'fav-tok',
      filename: 'fav.png',
      relative_path: 'tokens/fav.png',
    })
    const otherToken = makeToken({
      id: 'other-tok',
      filename: 'other.png',
      relative_path: 'tokens/other.png',
    })
    setupTokens([favToken, otherToken])
    mockIsFavorite.mockImplementation((type, id) => type === 'token' && id === 'fav-tok')

    renderView()
    await waitFor(() => expect(screen.getByText('other.png')).toBeInTheDocument())

    await toggleFavoritesFilter()
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()

    await toggleFavoritesFilter()
    expect(screen.getByText('other.png')).toBeInTheDocument()
  })

  it('shows favorites empty hint when filter is on and nothing matches', async () => {
    setupTokens([makeToken({ filename: 'unfav.png', relative_path: 'tokens/unfav.png' })])
    mockIsFavorite.mockReturnValue(false)

    renderView()
    await waitFor(() => expect(screen.getByText('unfav.png')).toBeInTheDocument())

    await toggleFavoritesFilter()
    expect(screen.getByText(/no favorites here yet/i)).toBeInTheDocument()
  })

  // Bulk mode: selecting tokens and opening the two bulk modals the view owns.
  describe('bulk actions', () => {
    async function enterBulkAndSelect(filename) {
      await userEvent.click(screen.getByRole('button', { name: /^select$/i }))
      await userEvent.click(screen.getByText(filename))
    }

    async function setupOneToken() {
      setupTokens([
        makeToken({ id: 't1', filename: 'goblin.png', relative_path: 'tokens/goblin.png' }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('goblin.png')).toBeInTheDocument())
      await enterBulkAndSelect('goblin.png')
    }

    it('opens the add-to-campaign modal with the selected tokens', async () => {
      await setupOneToken()
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))

      expect(screen.getByTestId('atc-count')).toHaveTextContent('1')
      expect(screen.getByTestId('atc-payload')).toHaveTextContent('t1')
    })

    it('closes the add-to-campaign modal', async () => {
      await setupOneToken()
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))
      await userEvent.click(screen.getByRole('button', { name: 'close atc' }))

      expect(screen.queryByTestId('add-to-campaign')).not.toBeInTheDocument()
    })

    // Issue #256: the modal closes but bulk mode and the selection stay up, so
    // the same batch can be sent to another campaign without re-picking it.
    it('keeps bulk mode once tokens are added to a campaign', async () => {
      await setupOneToken()
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))
      await userEvent.click(screen.getByRole('button', { name: 'confirm atc' }))

      expect(screen.queryByTestId('add-to-campaign')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument()
      expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    })

    it('opens the bulk edit modal for the token type', async () => {
      await setupOneToken()
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))

      expect(screen.getByTestId('be-type')).toHaveTextContent('token')
      expect(screen.getByTestId('be-count')).toHaveTextContent('1')
    })

    it('closes the bulk edit modal', async () => {
      await setupOneToken()
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))
      await userEvent.click(screen.getByRole('button', { name: 'close be' }))

      expect(screen.queryByTestId('bulk-edit')).not.toBeInTheDocument()
    })

    it('applies bulk edits and exits bulk mode on save', async () => {
      await setupOneToken()
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))
      await userEvent.click(screen.getByRole('button', { name: 'confirm be' }))

      expect(screen.queryByTestId('bulk-edit')).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByText('renamed.png')).toBeInTheDocument())
    })
  })

  it('text filter and favorites filter compose correctly', async () => {
    const favToken = makeToken({
      id: 'fav-tok',
      filename: 'dragon.png',
      relative_path: 'tokens/dragon.png',
    })
    const otherFav = makeToken({
      id: 'other-fav',
      filename: 'drake.png',
      relative_path: 'tokens/drake.png',
    })
    const nonFav = makeToken({
      id: 'non-fav',
      filename: 'goblin.png',
      relative_path: 'tokens/goblin.png',
    })
    setupTokens([favToken, otherFav, nonFav])
    mockIsFavorite.mockImplementation((type, id) => ['fav-tok', 'other-fav'].includes(id))

    renderView()
    await waitFor(() => expect(screen.getByText('goblin.png')).toBeInTheDocument())

    // Enable favorites filter — goblin.png should vanish
    await toggleFavoritesFilter()
    expect(screen.queryByText('goblin.png')).not.toBeInTheDocument()

    // The text search now lives in a standalone search box outside the modal.
    await userEvent.type(screen.getByPlaceholderText(/filter tokens/i), 'dragon')
    await waitFor(() => expect(screen.queryByText('drake.png')).not.toBeInTheDocument())
    expect(screen.getByText('dragon.png')).toBeInTheDocument()
  })
})
