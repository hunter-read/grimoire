import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { FavoritesProvider, useFavorites } from './FavoritesContext'
import api from '../api'

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}))

const mockGet = vi.mocked(api.get) as unknown as Mock
const mockPost = vi.mocked(api.post) as unknown as Mock
const mockDelete = vi.mocked(api.delete) as unknown as Mock

function FavDisplay({ type, id }: { type: string; id: string }) {
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
    mockGet.mockResolvedValue({
      favorites: [{ item_type: 'book', item_id: 'b1' }],
      items: [{ item_type: 'book', item_id: 'b1', title: 'PHB' }],
    })

    renderFavorites('book', 'b1')

    await waitFor(() => expect(screen.getByTestId('is-fav').textContent).toBe('yes'))
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('isFavorite returns false for items not in the list', async () => {
    mockGet.mockResolvedValue({ favorites: [], items: [] })

    renderFavorites('book', 'unknown')

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/favorites'))
    expect(screen.getByTestId('is-fav').textContent).toBe('no')
  })

  it('toggleFavorite calls POST and adds to local state when not yet favorited', async () => {
    // First call: initial load. Second call: reload after add.
    mockGet.mockResolvedValueOnce({ favorites: [], items: [] }).mockResolvedValueOnce({
      favorites: [{ item_type: 'book', item_id: 'b2' }],
      items: [],
    })
    mockPost.mockResolvedValue({ item_type: 'book', item_id: 'b2' })

    renderFavorites('book', 'b2')
    await waitFor(() => expect(api.get).toHaveBeenCalled())

    await act(() => screen.getByText('Toggle').click())

    expect(api.post).toHaveBeenCalledWith('/favorites', { item_type: 'book', item_id: 'b2' })
    await waitFor(() => expect(screen.getByTestId('is-fav').textContent).toBe('yes'))
  })

  it('toggleFavorite calls DELETE and removes from local state when already favorited', async () => {
    mockGet.mockResolvedValue({
      favorites: [{ item_type: 'book', item_id: 'b3' }],
      items: [{ item_type: 'book', item_id: 'b3', title: 'DMG' }],
    })
    mockDelete.mockResolvedValue(null)

    renderFavorites('book', 'b3')
    await waitFor(() => expect(screen.getByTestId('is-fav').textContent).toBe('yes'))

    await act(() => screen.getByText('Toggle').click())

    expect(api.delete).toHaveBeenCalledWith('/favorites/book/b3')
    await waitFor(() => expect(screen.getByTestId('is-fav').textContent).toBe('no'))
  })

  it('removes the item from the items list when unfavorited', async () => {
    mockGet.mockResolvedValue({
      favorites: [{ item_type: 'map', item_id: 'm1' }],
      items: [{ item_type: 'map', item_id: 'm1', filename: 'dungeon.png' }],
    })
    mockDelete.mockResolvedValue(null)

    renderFavorites('map', 'm1')
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))

    await act(() => screen.getByText('Toggle').click())

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'))
  })
})
