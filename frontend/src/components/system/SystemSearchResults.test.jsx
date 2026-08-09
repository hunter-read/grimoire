import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SystemSearchResults from './SystemSearchResults'

vi.mock('../../api', () => ({
  default: {},
  mediaUrl: (path) => `http://localhost${path}`,
}))

vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'systemDetail.matchingBooks')
        return `${o.count} matching book${o.count === 1 ? '' : 's'}`
      if (k === 'systemDetail.resultsInPages')
        return `${o.count} page result${o.count === 1 ? '' : 's'} for "${o.query}"`
      if (k === 'systemDetail.noResultsFound') return 'No results found'
      if (k === 'bookRow.openBook') return `Open ${o.title}`
      if (k === 'common.pagePrefixed') return `p. ${o.page}`
      return k
    },
  }),
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
}

const renderResults = (props) =>
  render(
    <MemoryRouter>
      <SystemSearchResults {...props} />
    </MemoryRouter>
  )

describe('SystemSearchResults', () => {
  it('renders nothing when searchResults is null', () => {
    const { container } = renderResults({ ...baseProps, searchResults: null, matchedBooks: [] })
    expect(container).toBeEmptyDOMElement()
  })

  // onOpenBook is removed — books now navigate via a real CardLink.
  // Assert the book is rendered; clicking the link is native router navigation.
  it('renders matching books above page hits', () => {
    const book = makeBook({ title: 'Curse of Strahd' })
    renderResults({
      ...baseProps,
      searchResults: { query: 'strahd', results: [] },
      matchedBooks: [book],
    })
    expect(screen.getByText('Curse of Strahd')).toBeInTheDocument()
    // The CardLink is a real anchor — verify it points to the reader.
    const link = screen.getByRole('link', { name: 'Open Curse of Strahd' })
    expect(link.getAttribute('href')).toBe(`/library/book/${book.id}`)
  })

  it('renders the empty state when nothing matched', () => {
    renderResults({
      ...baseProps,
      searchResults: { query: 'zzz', results: [] },
      matchedBooks: [],
    })
    // "No results" copy comes from the real i18n bundle (systemDetail.noResultsFound).
    expect(screen.getByText(/no results/i)).toBeInTheDocument()
  })

  // onOpenPage is removed — page hits now navigate via a real CardLink.
  // Assert the hit is rendered and the link has the right href.
  it('renders full-text page hits with links to the reader', () => {
    const result = {
      id: 'b1',
      title: 'Player Handbook',
      page_number: 42,
      snippet: '<mark>dragon</mark>',
    }
    renderResults({
      ...baseProps,
      searchResults: { query: 'dragon', results: [result] },
      matchedBooks: [],
    })
    expect(screen.getByText('Player Handbook')).toBeInTheDocument()
    // The snippet is injected as HTML.
    expect(screen.getByText('dragon')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Player Handbook — p. 42' })
    expect(link.getAttribute('href')).toBe('/library/book/b1?page=42')
  })

  it('applies hover styling on the page-result card', () => {
    const result = { id: 'b1', title: 'Player Handbook', page_number: 1, snippet: 'x' }
    renderResults({
      ...baseProps,
      searchResults: { query: 'x', results: [result] },
      matchedBooks: [],
    })
    const card = screen.getByText('Player Handbook').closest('div[style]').parentElement
    fireEvent.mouseEnter(card)
    expect(card.style.background).toBe('var(--bg-card-hover)')
    fireEvent.mouseLeave(card)
    expect(card.style.background).toBe('var(--bg-card)')
  })
})
