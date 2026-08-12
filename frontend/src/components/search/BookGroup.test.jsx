import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookGroup from './BookGroup'
import { cardStyle } from './searchStyles'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'common.pagePrefixed') return `p. ${o.page}`
      if (k === 'search.groupedBy') return `${o.count} page`
      if (k === 'search.expandBook') return `expand ${o.title}`
      if (k === 'search.collapseBook') return `collapse ${o.title}`
      return k
    },
  }),
}))

const group = {
  id: '7',
  title: 'Achtung! Cthulhu Gamemasters Guide',
  game_system: 'Achtung! Cthulhu (2d20)',
  pages: [{ page_number: 255, snippet: 'the <b>Cthulhu</b> stirs' }],
}

const renderGroup = (props = {}) =>
  render(
    <MemoryRouter>
      <BookGroup group={group} collapsed={{}} onToggle={() => {}} {...props} />
    </MemoryRouter>
  )

describe('BookGroup', () => {
  it('renders the book title, system and page count', () => {
    renderGroup()

    expect(screen.getByText('Achtung! Cthulhu Gamemasters Guide')).toBeInTheDocument()
    expect(screen.getByText('Achtung! Cthulhu (2d20)')).toBeInTheDocument()
    expect(screen.getByText('1 page')).toBeInTheDocument()
  })

  it('hides the page hits when collapsed', () => {
    renderGroup({ collapsed: { 'book-7': true } })

    expect(screen.getByText('Achtung! Cthulhu Gamemasters Guide')).toBeInTheDocument()
    expect(screen.queryByText(/p\. 255/)).not.toBeInTheDocument()
  })

  it('toggles the group when the header is clicked', async () => {
    const onToggle = vi.fn()
    renderGroup({ onToggle })

    await userEvent.click(screen.getByRole('button', { name: /collapse/i }))

    expect(onToggle).toHaveBeenCalledWith('book-7')
  })

  // Regression for issue #264: the title sits inside a <button>, which the UA
  // renders in black (`buttontext`) unless a colour is set. Against the dark
  // card background that made search results unreadable.
  it('gives the title row a themed text colour rather than the UA button default', () => {
    renderGroup()

    const header = screen.getByRole('button', { name: /collapse/i })
    expect(header).toHaveStyle({ color: 'var(--text)' })
  })

  it('sets an explicit colour on the shared card style', () => {
    expect(cardStyle.color).toBe('var(--text)')
  })
})
