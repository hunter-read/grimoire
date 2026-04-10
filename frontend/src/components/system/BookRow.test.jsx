import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import BookRow from './BookRow'
import * as FavCtx from '../../context/FavoritesContext'
import * as api from '../../api'

vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: vi.fn(),
}))

vi.mock('../../api', () => ({
  default: {},
  mediaUrl: (path) => `http://localhost${path}`,
}))

function makeBook(overrides = {}) {
  return {
    id: 'book-1',
    title: 'Player\'s Handbook',
    category: 'core',
    page_count: 320,
    year: 2014,
    publisher: 'WotC',
    has_thumbnail: false,
    is_explicit: false,
    indexed: false,
    index_failed: false,
    index_error: '',
    ...overrides,
  }
}

describe('BookRow', () => {
  beforeEach(() => {
    FavCtx.useFavorites.mockReturnValue({
      isFavorite: () => false,
      toggleFavorite: vi.fn(),
    })
  })

  it('renders the book title', () => {
    render(<BookRow book={makeBook()} onOpen={() => {}} />)
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('renders page count when present', () => {
    render(<BookRow book={makeBook()} onOpen={() => {}} />)
    expect(screen.getByText('320 pages')).toBeInTheDocument()
  })

  it('does not render page count when zero', () => {
    render(<BookRow book={makeBook({ page_count: 0 })} onOpen={() => {}} />)
    expect(screen.queryByText(/pages/)).not.toBeInTheDocument()
  })

  // --- indexed badge ---

  it('shows "indexed" badge when indexed is true', () => {
    render(<BookRow book={makeBook({ indexed: true })} onOpen={() => {}} />)
    expect(screen.getByText('indexed')).toBeInTheDocument()
  })

  it('does not show "indexed" badge when indexed is false', () => {
    render(<BookRow book={makeBook({ indexed: false })} onOpen={() => {}} />)
    expect(screen.queryByText('indexed')).not.toBeInTheDocument()
  })

  // --- index_failed badge ---

  it('shows "index failed" badge when index_failed is true', () => {
    render(<BookRow book={makeBook({ index_failed: true })} onOpen={() => {}} />)
    expect(screen.getByText('index failed')).toBeInTheDocument()
  })

  it('does not show "index failed" badge when index_failed is false', () => {
    render(<BookRow book={makeBook({ index_failed: false })} onOpen={() => {}} />)
    expect(screen.queryByText('index failed')).not.toBeInTheDocument()
  })

  it('"index failed" badge has a tooltip with the error message', () => {
    render(<BookRow book={makeBook({ index_failed: true, index_error: 'fitz timed out' })} onOpen={() => {}} />)
    const badge = screen.getByText('index failed')
    expect(badge.title).toBe('Index failed: fitz timed out')
  })

  it('"index failed" badge tooltip falls back gracefully when index_error is empty', () => {
    render(<BookRow book={makeBook({ index_failed: true, index_error: '' })} onOpen={() => {}} />)
    const badge = screen.getByText('index failed')
    expect(badge.title).toBe('Index failed')
  })

  it('does not show "indexed" badge when index_failed is true', () => {
    // A failed book should not be marked indexed
    render(<BookRow book={makeBook({ indexed: false, index_failed: true })} onOpen={() => {}} />)
    expect(screen.queryByText('indexed')).not.toBeInTheDocument()
    expect(screen.getByText('index failed')).toBeInTheDocument()
  })

  // --- explicit badge ---

  it('shows 18+ badge when is_explicit is true', () => {
    render(<BookRow book={makeBook({ is_explicit: true })} onOpen={() => {}} />)
    expect(screen.getByText('18+')).toBeInTheDocument()
  })

  it('does not show 18+ badge when is_explicit is false', () => {
    render(<BookRow book={makeBook({ is_explicit: false })} onOpen={() => {}} />)
    expect(screen.queryByText('18+')).not.toBeInTheDocument()
  })
})
