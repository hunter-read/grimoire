import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { FavoritesProvider, useFavorites } from './FavoritesContext'
import api from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}))

function FavDisplay({ type, id }) {
  const { isFavorite, toggleFavorite, items } = useFavorites()
  return (
    <div>
      <span data-testid="is-fav">{isFavorite(type, id) ? 'yes' : 'no'}</span>
      <span data-testid="count">{items.length}</span>
      <button onClick={() => toggleFavorite(type, id)}>Toggle</button>
    </div>
  )
}

function renderFavorites(type = 'book', id = 'b1') {
  return render(
    <FavoritesProvider>
      <FavDisplay type={type} id={id} />
    </FavoritesProvider>
  )
}

describe('FavoritesContext', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('loads favorites on mount', async () => {
    api.get.mockResolvedValue({
      favorites: [{ item_type: 'book', item_id: 'b1' }],
      items: [{ item_type: 'book', item_id: 'b1', title: 'PHB' }],
    })

    renderFavorites('book', 'b1')

    await waitFor(() => expect(screen.getByTestId('is-fav').textContent).toBe('yes'))
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('isFavorite returns false for items not in the list', async () => {
    api.get.mockResolvedValue({ favorites: [], items: [] })

    renderFavorites('book', 'unknown')

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/favorites'))
    expect(screen.getByTestId('is-fav').textContent).toBe('no')
  })

  it('toggleFavorite calls POST and adds to local state when not yet favorited', async () => {
    // First call: initial load. Second call: reload after add.
    api.get.mockResolvedValueOnce({ favorites: [], items: [] }).mockResolvedValueOnce({
      favorites: [{ item_type: 'book', item_id: 'b2' }],
      items: [],
    })
    api.post.mockResolvedValue({ item_type: 'book', item_id: 'b2' })

    renderFavorites('book', 'b2')
    await waitFor(() => expect(api.get).toHaveBeenCalled())

    await act(() => screen.getByText('Toggle').click())

    expect(api.post).toHaveBeenCalledWith('/favorites', { item_type: 'book', item_id: 'b2' })
    await waitFor(() => expect(screen.getByTestId('is-fav').textContent).toBe('yes'))
  })

  it('toggleFavorite calls DELETE and removes from local state when already favorited', async () => {
    api.get.mockResolvedValue({
      favorites: [{ item_type: 'book', item_id: 'b3' }],
      items: [{ item_type: 'book', item_id: 'b3', title: 'DMG' }],
    })
    api.delete.mockResolvedValue(null)

    renderFavorites('book', 'b3')
    await waitFor(() => expect(screen.getByTestId('is-fav').textContent).toBe('yes'))

    await act(() => screen.getByText('Toggle').click())

    expect(api.delete).toHaveBeenCalledWith('/favorites/book/b3')
    await waitFor(() => expect(screen.getByTestId('is-fav').textContent).toBe('no'))
  })

  it('removes the item from the items list when unfavorited', async () => {
    api.get.mockResolvedValue({
      favorites: [{ item_type: 'map', item_id: 'm1' }],
      items: [{ item_type: 'map', item_id: 'm1', filename: 'dungeon.png' }],
    })
    api.delete.mockResolvedValue(null)

    renderFavorites('map', 'm1')
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))

    await act(() => screen.getByText('Toggle').click())

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'))
  })
})
