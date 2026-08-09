import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FavoritesView from './FavoritesView'
import * as FavCtx from '../context/FavoritesContext'

vi.mock('../context/FavoritesContext', () => ({ useFavorites: vi.fn() }))
vi.mock('../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))

function renderWith(items) {
  FavCtx.useFavorites.mockReturnValue({
    items,
    isFavorite: () => true,
    toggleFavorite: vi.fn(),
  })
  return render(
    <MemoryRouter>
      <FavoritesView />
    </MemoryRouter>
  )
}

const aMap = { item_type: 'map', item_id: 'm1', filename: 'Dungeon.png', has_thumbnail: false }
const aBook = {
  item_type: 'book',
  item_id: 'b1',
  title: 'Core Rules',
  category: 'core',
  page_count: 100,
  has_thumbnail: false,
}

describe('FavoritesView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('shows the empty state when there are no favorites', () => {
    renderWith([])
    expect(screen.getByText('No favorites yet')).toBeInTheDocument()
  })

  it('renders a section per content type', () => {
    renderWith([aMap, aBook])
    expect(screen.getByText('Maps (1)')).toBeInTheDocument()
    expect(screen.getByText('Books (1)')).toBeInTheDocument()
    expect(screen.getByText('Dungeon.png')).toBeInTheDocument()
    expect(screen.getByText('Core Rules')).toBeInTheDocument()
  })

  it('collapses a section when its header is clicked and persists the state', () => {
    renderWith([aMap])
    expect(screen.getByText('Dungeon.png')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Maps \(1\)/ }))
    expect(screen.queryByText('Dungeon.png')).not.toBeInTheDocument()

    // Persisted: a fresh render starts collapsed.
    renderWith([aMap])
    expect(screen.queryByText('Dungeon.png')).not.toBeInTheDocument()
  })

  it('renders books as rows (list mode) by default', () => {
    // Books default to the list view style.
    renderWith([aBook])
    // The list row shows the page count meta that the grid card omits.
    expect(screen.getByText(/100 pages/)).toBeInTheDocument()
  })

  it('renders books as a grid when the book view mode is set to card', () => {
    localStorage.setItem('grimoire:user-prefs', JSON.stringify({ viewModes: { book: 'card' } }))
    renderWith([aBook])
    // Grid card omits the page-count meta line shown in the list row.
    expect(screen.queryByText(/100 pages/)).not.toBeInTheDocument()
    expect(screen.getByText('Core Rules')).toBeInTheDocument()
  })

  it('renders favorited tags as badge links that link to the tags page', () => {
    const aTag = {
      item_type: 'tag',
      item_id: 'draw steel',
      internal: 'draw steel',
      display: 'Draw Steel',
      count: 4,
    }
    renderWith([aTag])
    // Tags are now real <Link> anchors (not buttons) so middle-click works natively.
    const link = screen.getByRole('link', { name: 'Draw Steel' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/tags?tag=draw%20steel')
  })
})
