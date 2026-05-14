import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LibraryView from './LibraryView'
import api from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn() },
  mediaUrl: (path) => `http://localhost${path}`,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../hooks/useUserPrefs', () => ({
  getUserPrefs: () => ({ cardSize: 'comfortable', librarySort: 'az' }),
}))

vi.mock('../hooks/useBookPrefs', () => ({
  getRecentBooks: () => [],
  getBookPrefs: () => ({}),
}))

// Favorites context — default: nothing is a favorite
const mockIsFavorite = vi.fn(() => false)
vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: mockIsFavorite, toggleFavorite: vi.fn() }),
}))

vi.mock('../components/FavoriteButton', () => ({
  default: () => null,
}))

function makeSystem(overrides = {}) {
  const id = overrides.id ?? `sys-${Math.random().toString(36).slice(2)}`
  return {
    id,
    name: overrides.name ?? 'Test System',
    slug: id,
    book_count: 3,
    is_system_agnostic: false,
    cover_book_id: null,
    description: '',
    publishers: [],
    tags: [],
    is_explicit: false,
    ...overrides,
  }
}

function renderView() {
  return render(
    <MemoryRouter>
      <LibraryView />
    </MemoryRouter>
  )
}

describe('LibraryView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavorite.mockReturnValue(false)
  })

  it('renders system cards after loading', async () => {
    api.get.mockResolvedValue([makeSystem({ name: 'D&D 5e' })])
    renderView()
    await waitFor(() => expect(screen.getByText('D&D 5e')).toBeInTheDocument())
  })

  it('shows a spinner while loading', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    renderView()
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('shows the favorites-only toggle button', async () => {
    api.get.mockResolvedValue([makeSystem()])
    renderView()
    await waitFor(() => expect(screen.getByText(/favorites only/i)).toBeInTheDocument())
  })

  it('favorites toggle hides non-favorite systems', async () => {
    api.get.mockResolvedValue([
      makeSystem({ id: 'sys-fav', name: 'Favorite System' }),
      makeSystem({ id: 'sys-other', name: 'Other System' }),
    ])
    mockIsFavorite.mockImplementation((type, id) => type === 'system' && id === 'sys-fav')

    renderView()
    await waitFor(() => expect(screen.getByText('Favorite System')).toBeInTheDocument())

    await userEvent.click(screen.getByText(/favorites only/i))

    expect(screen.getByText('Favorite System')).toBeInTheDocument()
    expect(screen.queryByText('Other System')).not.toBeInTheDocument()
  })

  it('toggling favorites off restores all systems', async () => {
    api.get.mockResolvedValue([
      makeSystem({ id: 'sys-fav', name: 'Favorite System' }),
      makeSystem({ id: 'sys-other', name: 'Other System' }),
    ])
    mockIsFavorite.mockImplementation((type, id) => type === 'system' && id === 'sys-fav')

    renderView()
    await waitFor(() => expect(screen.getByText('Other System')).toBeInTheDocument())

    const toggle = screen.getByText(/favorites only/i)
    await userEvent.click(toggle)
    expect(screen.queryByText('Other System')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(screen.getByText('Other System')).toBeInTheDocument()
  })

  it('shows empty hint when favorites filter is on but nothing is favorited', async () => {
    api.get.mockResolvedValue([makeSystem({ name: 'Unfavorited System' })])
    mockIsFavorite.mockReturnValue(false)

    renderView()
    await waitFor(() => expect(screen.getByText('Unfavorited System')).toBeInTheDocument())

    await userEvent.click(screen.getByText(/favorites only/i))

    expect(screen.queryByText('Unfavorited System')).not.toBeInTheDocument()
    expect(screen.getByText(/no favorites here yet/i)).toBeInTheDocument()
  })
})
