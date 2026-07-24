import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SystemSearchResults from './SystemSearchResults'

vi.mock('../../api', () => ({
  default: {},
  mediaUrl: (path) => `http://localhost${path}`,
}))

vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}))

function makeBook(overrides = {}) {
  return {
    id: `book-${Math.random().toString(36).slice(2)}`,
    title: 'Matched Book',
    category: 'core',
    page_count: 100,
    has_thumbnail: false,
    is_explicit: false,
    is_missing: false,
    ...overrides,
  }
}

const baseProps = {
  booksContainerStyle: {},
  card: false,
  compact: false,
  onOpenBook: vi.fn(),
  onOpenPage: vi.fn(),
}

describe('SystemSearchResults', () => {
  it('renders nothing when searchResults is null', () => {
    const { container } = render(
      <SystemSearchResults {...baseProps} searchResults={null} matchedBooks={[]} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders matching books above page hits and fires onOpenBook', () => {
    const book = makeBook({ title: 'Curse of Strahd' })
    const onOpenBook = vi.fn()
    render(
      <SystemSearchResults
        {...baseProps}
        onOpenBook={onOpenBook}
        searchResults={{ query: 'strahd', results: [] }}
        matchedBooks={[book]}
      />
    )
    expect(screen.getByText('Curse of Strahd')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Curse of Strahd'))
    expect(onOpenBook).toHaveBeenCalledWith(book)
  })

  it('renders the empty state when nothing matched', () => {
    render(
      <SystemSearchResults
        {...baseProps}
        searchResults={{ query: 'zzz', results: [] }}
        matchedBooks={[]}
      />
    )
    // "No results" copy comes from the real i18n bundle (systemDetail.noResultsFound).
    expect(screen.getByText(/no results/i)).toBeInTheDocument()
  })

  it('renders full-text page hits and fires onOpenPage on click', () => {
    const onOpenPage = vi.fn()
    const result = {
      id: 'b1',
      title: 'Player Handbook',
      page_number: 42,
      snippet: '<mark>dragon</mark>',
    }
    render(
      <SystemSearchResults
        {...baseProps}
        onOpenPage={onOpenPage}
        searchResults={{ query: 'dragon', results: [result] }}
        matchedBooks={[]}
      />
    )
    expect(screen.getByText('Player Handbook')).toBeInTheDocument()
    // The snippet is injected as HTML.
    expect(screen.getByText('dragon')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Player Handbook'))
    expect(onOpenPage).toHaveBeenCalledWith(result)
  })

  it('applies hover styling on the page-result card', () => {
    const result = { id: 'b1', title: 'Player Handbook', page_number: 1, snippet: 'x' }
    render(
      <SystemSearchResults
        {...baseProps}
        searchResults={{ query: 'x', results: [result] }}
        matchedBooks={[]}
      />
    )
    const card = screen.getByText('Player Handbook').closest('div[style]').parentElement
    fireEvent.mouseEnter(card)
    expect(card.style.background).toBe('var(--bg-card-hover)')
    fireEvent.mouseLeave(card)
    expect(card.style.background).toBe('var(--bg-card)')
  })
})
