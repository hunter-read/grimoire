import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MapsView from './MapsView'
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
      <button onClick={() => onSaved({ m1: { filename: 'renamed.png' } })}>confirm be</button>
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

// Favorites is now a checkbox inside the Filters modal (no toolbar button).
async function toggleFavoritesFilter() {
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  await userEvent.click(screen.getByRole('checkbox', { name: /favorites/i }))
  await userEvent.click(screen.getByRole('button', { name: /done/i }))
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

  it('exposes a favorites filter in the Filters modal', async () => {
    setupMaps([makeMap({ filename: 'cave.png', relative_path: 'maps/cave.png' })])
    renderView()
    await waitFor(() => expect(screen.getByText('cave.png')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
    expect(screen.getByRole('checkbox', { name: /favorites/i })).toBeInTheDocument()
  })

  it('favorites filter hides non-favorite maps', async () => {
    const favMap = makeMap({ id: 'fav-map', filename: 'fav.png', relative_path: 'maps/fav.png' })
    const otherMap = makeMap({
      id: 'other-map',
      filename: 'other.png',
      relative_path: 'maps/other.png',
    })
    setupMaps([favMap, otherMap])
    mockIsFavorite.mockImplementation((type, id) => type === 'map' && id === 'fav-map')

    renderView()
    await waitFor(() => expect(screen.getByText('fav.png')).toBeInTheDocument())

    await toggleFavoritesFilter()

    expect(screen.getByText('fav.png')).toBeInTheDocument()
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()
  })

  it('toggling favorites off restores all maps', async () => {
    const favMap = makeMap({ id: 'fav-map', filename: 'fav.png', relative_path: 'maps/fav.png' })
    const otherMap = makeMap({
      id: 'other-map',
      filename: 'other.png',
      relative_path: 'maps/other.png',
    })
    setupMaps([favMap, otherMap])
    mockIsFavorite.mockImplementation((type, id) => type === 'map' && id === 'fav-map')

    renderView()
    await waitFor(() => expect(screen.getByText('other.png')).toBeInTheDocument())

    await toggleFavoritesFilter()
    expect(screen.queryByText('other.png')).not.toBeInTheDocument()

    await toggleFavoritesFilter()
    expect(screen.getByText('other.png')).toBeInTheDocument()
  })

  it('shows favorites empty hint when filter is on and nothing matches', async () => {
    setupMaps([makeMap({ filename: 'unfav.png', relative_path: 'maps/unfav.png' })])
    mockIsFavorite.mockReturnValue(false)

    renderView()
    await waitFor(() => expect(screen.getByText('unfav.png')).toBeInTheDocument())

    await toggleFavoritesFilter()
    expect(screen.getByText(/no favorites here yet/i)).toBeInTheDocument()
  })

  // Bulk mode: selecting maps and opening the two bulk modals the view owns.
  describe('bulk actions', () => {
    async function enterBulkAndSelect(filename) {
      await userEvent.click(screen.getByRole('button', { name: /^select$/i }))
      await userEvent.click(screen.getByText(filename))
    }

    it('opens the add-to-campaign modal with the selected maps', async () => {
      setupMaps([makeMap({ id: 'm1', filename: 'cave.png', relative_path: 'maps/cave.png' })])
      renderView()
      await waitFor(() => expect(screen.getByText('cave.png')).toBeInTheDocument())

      await enterBulkAndSelect('cave.png')
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))

      expect(screen.getByTestId('add-to-campaign')).toBeInTheDocument()
      expect(screen.getByTestId('atc-count')).toHaveTextContent('1')
    })

    it('closes the add-to-campaign modal', async () => {
      setupMaps([makeMap({ id: 'm1', filename: 'cave.png', relative_path: 'maps/cave.png' })])
      renderView()
      await waitFor(() => expect(screen.getByText('cave.png')).toBeInTheDocument())

      await enterBulkAndSelect('cave.png')
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))
      await userEvent.click(screen.getByRole('button', { name: 'close atc' }))

      expect(screen.queryByTestId('add-to-campaign')).not.toBeInTheDocument()
    })

    it('opens the bulk edit modal for the map type', async () => {
      setupMaps([makeMap({ id: 'm1', filename: 'cave.png', relative_path: 'maps/cave.png' })])
      renderView()
      await waitFor(() => expect(screen.getByText('cave.png')).toBeInTheDocument())

      await enterBulkAndSelect('cave.png')
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))

      expect(screen.getByTestId('be-type')).toHaveTextContent('map')
      expect(screen.getByTestId('be-count')).toHaveTextContent('1')
    })

    it('closes the bulk edit modal', async () => {
      setupMaps([makeMap({ id: 'm1', filename: 'cave.png', relative_path: 'maps/cave.png' })])
      renderView()
      await waitFor(() => expect(screen.getByText('cave.png')).toBeInTheDocument())

      await enterBulkAndSelect('cave.png')
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))
      await userEvent.click(screen.getByRole('button', { name: 'close be' }))

      expect(screen.queryByTestId('bulk-edit')).not.toBeInTheDocument()
    })

    it('sends the selected maps as campaign resources', async () => {
      setupMaps([makeMap({ id: 'm1', filename: 'cave.png', relative_path: 'maps/cave.png' })])
      renderView()
      await waitFor(() => expect(screen.getByText('cave.png')).toBeInTheDocument())

      await enterBulkAndSelect('cave.png')
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))

      expect(screen.getByTestId('atc-payload')).toHaveTextContent('m1')
    })

    // Issue #256: the modal closes but bulk mode and the selection stay up, so
    // the same batch can be sent to another campaign without re-picking it.
    it('keeps bulk mode once maps are added to a campaign', async () => {
      setupMaps([makeMap({ id: 'm1', filename: 'cave.png', relative_path: 'maps/cave.png' })])
      renderView()
      await waitFor(() => expect(screen.getByText('cave.png')).toBeInTheDocument())

      await enterBulkAndSelect('cave.png')
      await userEvent.click(screen.getByRole('button', { name: /add to campaign/i }))
      await userEvent.click(screen.getByRole('button', { name: 'confirm atc' }))

      expect(screen.queryByTestId('add-to-campaign')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^done$/i })).toBeInTheDocument()
      expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    })

    it('applies bulk edits and keeps the selection on save', async () => {
      setupMaps([makeMap({ id: 'm1', filename: 'cave.png', relative_path: 'maps/cave.png' })])
      renderView()
      await waitFor(() => expect(screen.getByText('cave.png')).toBeInTheDocument())

      await enterBulkAndSelect('cave.png')
      await userEvent.click(screen.getByRole('button', { name: /bulk edit/i }))
      await userEvent.click(screen.getByRole('button', { name: 'confirm be' }))

      expect(screen.queryByTestId('bulk-edit')).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByText('renamed.png')).toBeInTheDocument())
      // Issue #256: still in bulk mode with the map selected.
      expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    })
  })

  it('text filter and favorites filter compose correctly', async () => {
    const favMap = makeMap({
      id: 'fav-map',
      filename: 'dragon.png',
      relative_path: 'maps/dragon.png',
    })
    const otherFav = makeMap({
      id: 'other-fav',
      filename: 'dungeon.png',
      relative_path: 'maps/dungeon.png',
    })
    const nonFav = makeMap({
      id: 'non-fav',
      filename: 'forest.png',
      relative_path: 'maps/forest.png',
    })
    setupMaps([favMap, otherFav, nonFav])
    mockIsFavorite.mockImplementation((type, id) => ['fav-map', 'other-fav'].includes(id))

    renderView()
    await waitFor(() => expect(screen.getByText('forest.png')).toBeInTheDocument())

    // Enable favorites filter — forest.png should vanish
    await toggleFavoritesFilter()
    expect(screen.queryByText('forest.png')).not.toBeInTheDocument()

    // The text search now lives in a standalone search box outside the modal.
    await userEvent.type(screen.getByPlaceholderText(/filter maps/i), 'dragon')
    await waitFor(() => expect(screen.queryByText('dungeon.png')).not.toBeInTheDocument())
    expect(screen.getByText('dragon.png')).toBeInTheDocument()
  })
  describe('subtitle count (filtered vs total)', () => {
    it('shows the plain total when nothing is filtered out', async () => {
      setupMaps([
        makeMap({ filename: 'dungeon.png', relative_path: 'maps/dungeon.png' }),
        makeMap({ filename: 'cave.png', relative_path: 'maps/cave.png' }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('2 maps in your collection')).toBeInTheDocument())
    })

    it('switches to "x of y" once a filter hides something', async () => {
      setupMaps([
        makeMap({ filename: 'dungeon.png', relative_path: 'maps/dungeon.png' }),
        makeMap({ filename: 'cave.png', relative_path: 'maps/cave.png' }),
        makeMap({ filename: 'forest.png', relative_path: 'maps/forest.png' }),
      ])
      renderView()
      await waitFor(() => expect(screen.getByText('3 maps in your collection')).toBeInTheDocument())

      await userEvent.type(screen.getByPlaceholderText(/filter maps/i), 'cave')

      await waitFor(() =>
        expect(screen.getByText('Displaying 1 of 3 maps in your collection')).toBeInTheDocument()
      )
      expect(screen.queryByText('3 maps in your collection')).not.toBeInTheDocument()
    })

    it('counts only the rows this user received, not the server total', async () => {
      // A server-side total that exceeds the delivered rows (pagination, or a
      // user who may not see everything) must never become the denominator.
      api.get.mockImplementation((url) => {
        if (url === '/maps')
          return Promise.resolve({
            maps: [
              makeMap({ filename: 'dungeon.png', relative_path: 'maps/dungeon.png' }),
              makeMap({ filename: 'cave.png', relative_path: 'maps/cave.png' }),
            ],
            total: 99,
          })
        if (url === '/map-folders') return Promise.resolve({ folders: [] })
        return Promise.resolve({})
      })
      renderView()
      await waitFor(() => expect(screen.getByText('2 maps in your collection')).toBeInTheDocument())

      await userEvent.type(screen.getByPlaceholderText(/filter maps/i), 'cave')

      await waitFor(() =>
        expect(screen.getByText('Displaying 1 of 2 maps in your collection')).toBeInTheDocument()
      )
    })
  })
})
