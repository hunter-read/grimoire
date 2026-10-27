import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookMatchCard from './BookMatchCard'

vi.mock('../../api', () => ({
  imageSources: { thumbUrl: (type, id) => `/api/${type}s/${id}/thumbnail` },
}))

function makeBook(overrides = {}) {
  return {
    id: 'b1',
    title: 'Avatar Legends Core Rulebook',
    game_system: 'Powered by the Apocalypse',
    game_system_id: 'sys-1',
    authors: ['Magpie Games'],
    publisher: 'Magpie Games',
    year: 2022,
    page_count: 280,
    has_thumbnail: true,
    tags: ['core'],
    ...overrides,
  }
}

function renderCard(book = makeBook()) {
  return render(
    <MemoryRouter>
      <BookMatchCard book={book} />
    </MemoryRouter>
  )
}

describe('BookMatchCard', () => {
  it('shows the book title', () => {
    renderCard()
    expect(screen.getByText('Avatar Legends Core Rulebook')).toBeInTheDocument()
  })

  it('links to the book, not to a page inside it', () => {
    renderCard()
    const link = screen.getByRole('link', { name: 'Avatar Legends Core Rulebook' })
    expect(link.getAttribute('href')).toBe('/library/book/b1')
  })

  it('shows system, authors and year on the metadata line', () => {
    renderCard()
    expect(screen.getByText(/Powered by the Apocalypse/)).toBeInTheDocument()
    expect(screen.getByText(/Magpie Games/)).toBeInTheDocument()
    expect(screen.getByText(/2022/)).toBeInTheDocument()
  })

  it('omits the metadata line entirely when the book has none of it', () => {
    const { container } = renderCard(
      makeBook({ game_system: '', authors: [], year: null, tags: [] })
    )
    expect(container.textContent).toContain('Avatar Legends Core Rulebook')
    expect(container.textContent).not.toContain('·')
  })

  it('renders the cover thumbnail', () => {
    const { container } = renderCard()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/books/b1/thumbnail')
  })

  it('renders tag chips when the book is tagged', () => {
    renderCard()
    expect(screen.getByText('core')).toBeInTheDocument()
  })

  it('has no page-hit expander — a title match is about the book itself', () => {
    renderCard()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('highlights on hover and restores the base background on leave', async () => {
    renderCard()
    const card = screen
      .getByText('Avatar Legends Core Rulebook')
      .closest('div[style*="border-radius"]')

    await userEvent.hover(card)
    expect(card.style.background).toBe('var(--bg-card-hover)')

    await userEvent.unhover(card)
    expect(card.style.background).toBe('var(--bg-card)')
  })

  it('renders the fallback glyph when the book has no cover', () => {
    const { container } = renderCard(makeBook({ has_thumbnail: false }))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('omits tag chips when the book is untagged', () => {
    renderCard(makeBook({ tags: [] }))
    expect(screen.queryByText('core')).toBeNull()
  })

  it('builds the metadata line from whichever fields the book actually has', () => {
    renderCard(makeBook({ game_system: '', authors: [], year: 2022, tags: [] }))
    expect(screen.getByText('2022')).toBeInTheDocument()
  })
})
