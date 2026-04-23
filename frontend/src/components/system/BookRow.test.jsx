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
    title: "Player's Handbook",
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

  it('shows "Indexed" badge when indexed is true', () => {
    render(<BookRow book={makeBook({ indexed: true })} onOpen={() => {}} />)
    expect(screen.getByText('Indexed')).toBeInTheDocument()
  })

  it('does not show "Indexed" badge when indexed is false', () => {
    render(<BookRow book={makeBook({ indexed: false })} onOpen={() => {}} />)
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  // --- index_failed badge ---

  it('shows "Index Failed" badge when index_failed is true', () => {
    render(<BookRow book={makeBook({ index_failed: true })} onOpen={() => {}} />)
    expect(screen.getByText('Index Failed')).toBeInTheDocument()
  })

  it('does not show "Index Failed" badge when index_failed is false', () => {
    render(<BookRow book={makeBook({ index_failed: false })} onOpen={() => {}} />)
    expect(screen.queryByText('Index Failed')).not.toBeInTheDocument()
  })

  it('"Index Failed" badge has a tooltip with the error message', () => {
    render(
      <BookRow
        book={makeBook({ index_failed: true, index_error: 'fitz timed out' })}
        onOpen={() => {}}
      />
    )
    const badge = screen.getByText('Index Failed')
    expect(badge.title).toBe('Index failed: fitz timed out')
  })

  it('"Index Failed" badge tooltip falls back gracefully when index_error is empty', () => {
    render(<BookRow book={makeBook({ index_failed: true, index_error: '' })} onOpen={() => {}} />)
    const badge = screen.getByText('Index Failed')
    expect(badge.title).toBe('Index failed')
  })

  it('does not show "Indexed" badge when index_failed is true', () => {
    // A failed book should not be marked indexed
    render(<BookRow book={makeBook({ indexed: false, index_failed: true })} onOpen={() => {}} />)
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
    expect(screen.getByText('Index Failed')).toBeInTheDocument()
  })

  // --- is_missing badge ---

  it('shows "Missing" badge when is_missing is true', () => {
    render(<BookRow book={makeBook({ is_missing: true })} onOpen={() => {}} />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })

  it('does not show "Missing" badge when is_missing is false', () => {
    render(<BookRow book={makeBook({ is_missing: false })} onOpen={() => {}} />)
    expect(screen.queryByText('Missing')).not.toBeInTheDocument()
  })

  it('"Missing" badge replaces "Indexed" badge', () => {
    render(<BookRow book={makeBook({ is_missing: true, indexed: true })} onOpen={() => {}} />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  it('"Missing" badge replaces "Index Failed" badge', () => {
    render(<BookRow book={makeBook({ is_missing: true, index_failed: true })} onOpen={() => {}} />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.queryByText('Index Failed')).not.toBeInTheDocument()
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
