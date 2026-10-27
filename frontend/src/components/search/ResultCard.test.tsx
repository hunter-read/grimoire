import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ResultCard from './ResultCard'

const renderCard = (props) =>
  render(
    <MemoryRouter>
      <ResultCard {...props} />
    </MemoryRouter>
  )

describe('ResultCard', () => {
  it('renders the title, path and tags', () => {
    renderCard({
      to: '/maps/5',
      title: 'tavern.jpg',
      subtitle: 'Maps/Taverns',
      tags: ['indoor'],
    })

    expect(screen.getByText('tavern.jpg')).toBeInTheDocument()
    expect(screen.getByText('Maps/Taverns')).toBeInTheDocument()
    expect(screen.getByText('indoor')).toBeInTheDocument()
  })

  it('omits the tag list when the item has no tags', () => {
    renderCard({ to: '/maps/5', title: 'tavern.jpg', subtitle: 'Maps' })

    expect(screen.getByText('tavern.jpg')).toBeInTheDocument()
  })

  // ResultCard is now a real <Link> via CardLink — assert the href rather than
  // an onOpen spy. Plain click navigates in-place; middle/ctrl-click is native.
  it('renders a link to the detail page', () => {
    renderCard({ to: '/maps/5', title: 'tavern.jpg', subtitle: 'Maps' })

    const link = screen.getByRole('link', { name: 'tavern.jpg' })
    expect(link.getAttribute('href')).toBe('/maps/5')
  })

  it('highlights on hover and restores the base background on leave', async () => {
    renderCard({ to: '/maps/5', title: 'tavern.jpg', subtitle: 'Maps' })
    // The card is the element carrying the hover handlers, not a fixed number
    // of parents up — the row gained a thumbnail column in issue #343.
    const card = screen.getByText('tavern.jpg').closest('div[style*="border-radius"]')

    await userEvent.hover(card)
    expect(card.style.background).toBe('var(--bg-card-hover)')

    await userEvent.unhover(card)
    expect(card.style.background).toBe('var(--bg-card)')
  })

  // Middle-click opens a new tab natively — no JS needed, just verify the href.
  it('is a real anchor so middle click opens the detail page in a new tab natively', () => {
    renderCard({ to: '/tokens/8', title: 'goblin.png', subtitle: 'Tokens' })

    const link = screen.getByRole('link', { name: 'goblin.png' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/tokens/8')
  })
})
