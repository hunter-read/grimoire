import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TokensView from './TokensView'
import api from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
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
  default: () => null,
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

  it('shows the Favorites only button', async () => {
    setupTokens([makeToken({ filename: 'orc.png', relative_path: 'tokens/orc.png' })])
    renderView()
    await waitFor(() => expect(screen.getByText(/favorites only/i)).toBeInTheDocument())
  })

  it('favorites filter hides non-favorite tokens', async () => {
    const favToken = makeToken({ id: 'fav-tok', filename: 'fav.png', relative_path: 'tokens/fav.png' })
    const otherToken = makeToken({ id: 'other-tok', filename: 'other.png', relative_path: 'tokens/other.png' })
    setupTokens([favToken, otherToken])
    mockIsFavorite.mockImplementation((type, id) => type === 'token' && id === 'fav-tok')

    renderView()
    await waitFor(() => expect(screen.getByText('fav.png')).toBeInTheDocument())

    await userEvent.click(screen.getByText(/favorites only/i))

    expect(screen.getByText('fav.png')).toBeInTheDocument()
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()
  })

  it('toggling favorites off restores all tokens', async () => {
    const favToken = makeToken({ id: 'fav-tok', filename: 'fav.png', relative_path: 'tokens/fav.png' })
    const otherToken = makeToken({ id: 'other-tok', filename: 'other.png', relative_path: 'tokens/other.png' })
    setupTokens([favToken, otherToken])
    mockIsFavorite.mockImplementation((type, id) => type === 'token' && id === 'fav-tok')

    renderView()
    await waitFor(() => expect(screen.getByText('other.png')).toBeInTheDocument())

    const toggle = screen.getByText(/favorites only/i)
    await userEvent.click(toggle)
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(screen.getByText('other.png')).toBeInTheDocument()
  })

  it('shows favorites empty hint when filter is on and nothing matches', async () => {
    setupTokens([makeToken({ filename: 'unfav.png', relative_path: 'tokens/unfav.png' })])
    mockIsFavorite.mockReturnValue(false)

    renderView()
    await waitFor(() => expect(screen.getByText('unfav.png')).toBeInTheDocument())

    await userEvent.click(screen.getByText(/favorites only/i))
    expect(screen.getByText(/no favorites here yet/i)).toBeInTheDocument()
  })

  it('text filter and favorites filter compose correctly', async () => {
    const favToken = makeToken({ id: 'fav-tok', filename: 'dragon.png', relative_path: 'tokens/dragon.png' })
    const otherFav = makeToken({ id: 'other-fav', filename: 'drake.png', relative_path: 'tokens/drake.png' })
    const nonFav = makeToken({ id: 'non-fav', filename: 'goblin.png', relative_path: 'tokens/goblin.png' })
    setupTokens([favToken, otherFav, nonFav])
    mockIsFavorite.mockImplementation((type, id) => ['fav-tok', 'other-fav'].includes(id))

    renderView()
    await waitFor(() => expect(screen.getByText('goblin.png')).toBeInTheDocument())

    // Enable favorites filter — goblin.png should vanish
    await userEvent.click(screen.getByText(/favorites only/i))
    expect(screen.queryByText('goblin.png')).not.toBeInTheDocument()

    // Also apply text filter for "dragon" — only dragon.png remains
    await userEvent.type(screen.getByPlaceholderText(/filter tokens/i), 'dragon')
    await waitFor(() => expect(screen.queryByText('drake.png')).not.toBeInTheDocument())
    expect(screen.getByText('dragon.png')).toBeInTheDocument()
  })
})
