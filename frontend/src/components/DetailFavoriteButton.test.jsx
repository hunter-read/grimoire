import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DetailFavoriteButton from './DetailFavoriteButton'
import * as FavCtx from '../context/FavoritesContext'

vi.mock('../context/FavoritesContext', () => ({
  useFavorites: vi.fn(),
}))

describe('DetailFavoriteButton', () => {
  const toggleFavorite = vi.fn()

  function setup(isFav, props = {}) {
    FavCtx.useFavorites.mockReturnValue({ isFavorite: () => isFav, toggleFavorite })
    return render(<DetailFavoriteButton type="map" id="m1" {...props} />)
  }

  beforeEach(() => {
    vi.resetAllMocks()
    toggleFavorite.mockReset()
  })

  it('labels itself "Add to favorites" when not favorited', () => {
    setup(false)
    expect(screen.getByRole('button', { name: 'Add to favorites' })).toBeInTheDocument()
  })

  it('labels itself "Remove from favorites" when already favorited', () => {
    setup(true)
    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toBeInTheDocument()
  })

  it('reports its state through aria-pressed', () => {
    setup(true)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggles the favorite with the item type and id when clicked', () => {
    setup(false)
    fireEvent.click(screen.getByRole('button'))
    expect(toggleFavorite).toHaveBeenCalledWith('map', 'm1')
  })

  it('shows its label as text by default', () => {
    setup(false)
    expect(screen.getByRole('button')).toHaveTextContent('Add to favorites')
  })

  it('hides the label text when compact', () => {
    setup(false, { compact: true })
    const btn = screen.getByRole('button')
    expect(btn).not.toHaveTextContent('Add to favorites')
    expect(btn).toHaveAttribute('aria-label', 'Add to favorites')
  })

  it('accepts style overrides', () => {
    setup(false, { style: { marginLeft: 8 } })
    expect(screen.getByRole('button')).toHaveStyle({ marginLeft: '8px' })
  })

  // The media detail views render in contexts without a FavoritesProvider, so a
  // null context must degrade to an inert button rather than crashing the view.
  it('renders inertly with no favorites provider', () => {
    FavCtx.useFavorites.mockReturnValue(null)
    render(<DetailFavoriteButton type="map" id="m1" />)
    const btn = screen.getByRole('button', { name: 'Add to favorites' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(() => fireEvent.click(btn)).not.toThrow()
  })
})
