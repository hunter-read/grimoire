import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MapsView from './MapsView'
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

// Start all folders expanded so map filenames are immediately visible.
vi.mock('../hooks/useSessionState', () => ({
  default: (_key, _init) => [new Set(), vi.fn()],
}))

function makeMap(overrides = {}) {
  const id = overrides.id ?? `map-${Math.random().toString(36).slice(2)}`
  return {
    id,
    filename: overrides.filename ?? `map-${id}.png`,
    relative_path: overrides.relative_path ?? `maps/${overrides.filename ?? `map-${id}.png`}`,
    filepath: `/tmp/${id}.png`,
    tags: overrides.tags ?? [],
    has_thumbnail: false,
    is_missing: false,
    ...overrides,
  }
}

function makeMapsResponse(maps = []) {
  return { maps, total: maps.length }
}

function renderView() {
  return render(
    <MemoryRouter>
      <MapsView />
    </MemoryRouter>
  )
}

describe('MapsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
  })

  function setupMaps(maps) {
    api.get.mockImplementation((url) => {
      if (url === '/maps') return Promise.resolve(makeMapsResponse(maps))
      if (url === '/map-folders') return Promise.resolve({ folders: [] })
      return Promise.resolve({})
    })
  }

  it('renders map filenames after loading', async () => {
    setupMaps([makeMap({ filename: 'dungeon.png', relative_path: 'maps/dungeon.png' })])
    renderView()
    await waitFor(() => expect(screen.getByText('dungeon.png')).toBeInTheDocument())
  })

  it('shows a spinner while loading', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    renderView()
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('shows the Favorites only button', async () => {
    setupMaps([makeMap({ filename: 'cave.png', relative_path: 'maps/cave.png' })])
    renderView()
    await waitFor(() => expect(screen.getByText(/favorites only/i)).toBeInTheDocument())
  })

  it('favorites filter hides non-favorite maps', async () => {
    const favMap = makeMap({ id: 'fav-map', filename: 'fav.png', relative_path: 'maps/fav.png' })
    const otherMap = makeMap({ id: 'other-map', filename: 'other.png', relative_path: 'maps/other.png' })
    setupMaps([favMap, otherMap])
    mockIsFavorite.mockImplementation((type, id) => type === 'map' && id === 'fav-map')

    renderView()
    await waitFor(() => expect(screen.getByText('fav.png')).toBeInTheDocument())

    await userEvent.click(screen.getByText(/favorites only/i))

    expect(screen.getByText('fav.png')).toBeInTheDocument()
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()
  })

  it('toggling favorites off restores all maps', async () => {
    const favMap = makeMap({ id: 'fav-map', filename: 'fav.png', relative_path: 'maps/fav.png' })
    const otherMap = makeMap({ id: 'other-map', filename: 'other.png', relative_path: 'maps/other.png' })
    setupMaps([favMap, otherMap])
    mockIsFavorite.mockImplementation((type, id) => type === 'map' && id === 'fav-map')

    renderView()
    await waitFor(() => expect(screen.getByText('other.png')).toBeInTheDocument())

    const toggle = screen.getByText(/favorites only/i)
    await userEvent.click(toggle)
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(screen.getByText('other.png')).toBeInTheDocument()
  })

  it('shows favorites empty hint when filter is on and nothing matches', async () => {
    setupMaps([makeMap({ filename: 'unfav.png', relative_path: 'maps/unfav.png' })])
    mockIsFavorite.mockReturnValue(false)

    renderView()
    await waitFor(() => expect(screen.getByText('unfav.png')).toBeInTheDocument())

    await userEvent.click(screen.getByText(/favorites only/i))
    expect(screen.getByText(/no favorites here yet/i)).toBeInTheDocument()
  })

  it('text filter and favorites filter compose correctly', async () => {
    const favMap = makeMap({ id: 'fav-map', filename: 'dragon.png', relative_path: 'maps/dragon.png' })
    const otherFav = makeMap({ id: 'other-fav', filename: 'dungeon.png', relative_path: 'maps/dungeon.png' })
    const nonFav = makeMap({ id: 'non-fav', filename: 'forest.png', relative_path: 'maps/forest.png' })
    setupMaps([favMap, otherFav, nonFav])
    mockIsFavorite.mockImplementation((type, id) => ['fav-map', 'other-fav'].includes(id))

    renderView()
    await waitFor(() => expect(screen.getByText('forest.png')).toBeInTheDocument())

    // Enable favorites filter — forest.png should vanish
    await userEvent.click(screen.getByText(/favorites only/i))
    expect(screen.queryByText('forest.png')).not.toBeInTheDocument()

    // Also apply text filter for "dragon" — only dragon.png remains
    await userEvent.type(screen.getByPlaceholderText(/filter maps/i), 'dragon')
    await waitFor(() => expect(screen.queryByText('dungeon.png')).not.toBeInTheDocument())
    expect(screen.getByText('dragon.png')).toBeInTheDocument()
  })
})
