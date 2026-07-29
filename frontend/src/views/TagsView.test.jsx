import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TagsView from './TagsView'

// --- Mocks -----------------------------------------------------------------

const mockList = vi.fn()
const mockItems = vi.fn()
const mockRename = vi.fn()
const mockRemove = vi.fn()

vi.mock('../api', () => ({
  tags: {
    list: (...a) => mockList(...a),
    items: (...a) => mockItems(...a),
    rename: (...a) => mockRename(...a),
    remove: (...a) => mockRemove(...a),
  },
  mediaUrl: (p) => `http://localhost${p}`,
}))

let mockRole = 'admin'
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole } }),
}))

const mockToggleFavorite = vi.fn()
const mockIsFavorite = vi.fn(() => false)
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite, toggleFavorite: mockToggleFavorite }),
}))

// Cards pull in media/context — stub to plain output. TagTypeSection renders
// for real so its type/folder layout is exercised.
vi.mock('../components/favorites/BookFavorite', () => ({
  default: ({ item }) => <div data-testid="book-card">{item.item_id}</div>,
}))
vi.mock('../components/favorites/MapFavorite', () => ({
  default: ({ item }) => <div data-testid="map-card">{item.item_id}</div>,
}))
vi.mock('../components/favorites/TokenFavorite', () => ({
  default: ({ item }) => <div data-testid="token-card">{item.item_id}</div>,
}))
vi.mock('../components/favorites/AudioFavorite', () => ({
  default: ({ item }) => <div data-testid="audio-card">{item.item_id}</div>,
}))
vi.mock('../components/favorites/SystemFavorite', () => ({
  default: ({ item }) => <div data-testid="system-card">{item.item_id}</div>,
}))

function renderView(initialEntry = '/tags') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TagsView />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRole = 'admin'
  mockIsFavorite.mockReturnValue(false)
  mockList.mockResolvedValue({
    tags: [
      { internal: 'forest', display: 'Forest', category: 'map', count: 3, is_favorite: false },
      { internal: 'strahd', display: 'Strahd', category: 'shared', count: 1, is_favorite: true },
    ],
  })
  mockItems.mockResolvedValue({
    internal: 'forest',
    display: 'Forest',
    items: [
      { item_type: 'map', item_id: 'm1' },
      { item_type: 'book', item_id: 'b1' },
    ],
    folders: [],
  })
})

describe('TagsView', () => {
  it('lists all tags with their usage counts', async () => {
    renderView()
    expect(await screen.findByText('Forest')).toBeInTheDocument()
    expect(screen.getByText('Strahd')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows an empty state when there are no tags', async () => {
    mockList.mockResolvedValue({ tags: [] })
    renderView()
    expect(await screen.findByText(/no tags yet/i)).toBeInTheDocument()
  })

  it('filters the tag list by text', async () => {
    renderView()
    await screen.findByText('Forest')
    await userEvent.type(screen.getByLabelText(/filter tags/i), 'stra')
    expect(screen.queryByText('Forest')).not.toBeInTheDocument()
    expect(screen.getByText('Strahd')).toBeInTheDocument()
  })

  it('filters to favorites only when the favorites toggle is on', async () => {
    renderView()
    await screen.findByText('Forest')
    // Strahd is the only favorited tag in the fixture.
    await userEvent.click(screen.getByLabelText(/favorites only/i))
    expect(screen.queryByText('Forest')).not.toBeInTheDocument()
    expect(screen.getByText('Strahd')).toBeInTheDocument()
  })

  it('sorts tags by count when chosen', async () => {
    renderView()
    await screen.findByText('Forest')
    await userEvent.selectOptions(screen.getByLabelText(/^sort$/i), 'count')
    // Ascending by count → Strahd (1) before Forest (3).
    const names = screen.getAllByText(/Forest|Strahd/).map((n) => n.textContent)
    expect(names.indexOf('Strahd')).toBeLessThan(names.indexOf('Forest'))
  })

  it('groups the tag list by category with Shared on top', async () => {
    renderView()
    await screen.findByText('Forest')
    // Category group headers render (Shared and Map); Shared appears first.
    const groups = screen.getAllByRole('group')
    expect(groups[0]).toHaveAttribute('aria-label', expect.stringMatching(/shared/i))
    // Strahd (shared) is inside the Shared group; Forest (map) inside the Map group.
    expect(groups[0]).toHaveTextContent('Strahd')
    expect(screen.getByRole('group', { name: /map/i })).toHaveTextContent('Forest')
  })

  it('favorites a tag from the list heart', async () => {
    renderView()
    await screen.findByText('Forest')
    // Two hearts render (Forest not-fav, Strahd fav). Click Forest's.
    const hearts = screen.getAllByLabelText(/^favorite$/i)
    await userEvent.click(hearts[0])
    expect(mockToggleFavorite).toHaveBeenCalledWith('tag', 'forest')
  })

  it('loads and groups a tag’s items when selected', async () => {
    renderView()
    await userEvent.click(await screen.findByText('Forest'))
    await waitFor(() => expect(mockItems).toHaveBeenCalledWith('forest'))
    expect(await screen.findByTestId('map-card')).toHaveTextContent('m1')
    expect(screen.getByTestId('book-card')).toHaveTextContent('b1')
  })

  it('renders folder groups for folder-derived tags', async () => {
    mockItems.mockResolvedValue({
      internal: 'forest',
      display: 'Forest',
      items: [],
      folders: [
        { resource_type: 'map', path: 'Woods', items: [{ item_type: 'map', item_id: 'mf1' }] },
      ],
    })
    renderView('/tags?tag=forest')
    await waitFor(() => expect(mockItems).toHaveBeenCalledWith('forest'))
    expect(await screen.findByText('Woods')).toBeInTheDocument()
    expect(screen.getByTestId('map-card')).toHaveTextContent('mf1')
  })

  it('deep-links to a tag from the ?tag= query param', async () => {
    renderView('/tags?tag=forest')
    await waitFor(() => expect(mockItems).toHaveBeenCalledWith('forest'))
    expect(await screen.findByRole('heading', { name: 'Forest' })).toBeInTheDocument()
  })

  it('lets an editor rename a tag’s display value', async () => {
    mockRename.mockResolvedValue({ internal: 'forest', display: 'Deep Forest' })
    renderView('/tags?tag=forest')
    await screen.findByRole('heading', { name: 'Forest' })
    await userEvent.click(screen.getByLabelText(/^rename$/i))
    const input = screen.getByLabelText(/display name/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'Deep Forest')
    await userEvent.click(screen.getByLabelText(/save/i))
    await waitFor(() => expect(mockRename).toHaveBeenCalledWith('forest', 'Deep Forest'))
  })

  it('hides edit controls for non-editors', async () => {
    mockRole = 'player'
    renderView('/tags?tag=forest')
    await screen.findByRole('heading', { name: 'Forest' })
    expect(screen.queryByLabelText(/^rename$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/delete tag/i)).not.toBeInTheDocument()
  })

  it('deletes a tag after confirmation', async () => {
    mockRemove.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderView('/tags?tag=forest')
    await screen.findByRole('heading', { name: 'Forest' })
    await userEvent.click(screen.getByLabelText(/delete tag/i))
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('forest'))
    window.confirm.mockRestore()
  })
})
