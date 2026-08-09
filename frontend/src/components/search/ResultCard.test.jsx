import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResultCard from './ResultCard'

describe('ResultCard', () => {
  let open

  beforeEach(() => {
    open = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    open.mockRestore()
  })

  it('renders the title, path and tags', () => {
    render(
      <ResultCard
        to="/maps/5"
        title="tavern.jpg"
        subtitle="Maps/Taverns"
        tags={['indoor']}
        onOpen={vi.fn()}
      />
    )

    expect(screen.getByText('tavern.jpg')).toBeInTheDocument()
    expect(screen.getByText('Maps/Taverns')).toBeInTheDocument()
    expect(screen.getByText('indoor')).toBeInTheDocument()
  })

  it('omits the tag list when the item has no tags', () => {
    render(<ResultCard to="/maps/5" title="tavern.jpg" subtitle="Maps" onOpen={vi.fn()} />)

    expect(screen.getByText('tavern.jpg')).toBeInTheDocument()
  })

  it('navigates in place on a plain click', async () => {
    const onOpen = vi.fn()
    render(<ResultCard to="/maps/5" title="tavern.jpg" subtitle="Maps" onOpen={onOpen} />)

    await userEvent.click(screen.getByText('tavern.jpg'))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('highlights on hover and restores the base background on leave', async () => {
    render(<ResultCard to="/maps/5" title="tavern.jpg" subtitle="Maps" onOpen={vi.fn()} />)
    const card = screen.getByText('tavern.jpg').parentElement

    await userEvent.hover(card)
    expect(card.style.background).toBe('var(--bg-card-hover)')

    await userEvent.unhover(card)
    expect(card.style.background).toBe('var(--bg-card)')
  })

  it('opens the detail page in a new tab on middle click', async () => {
    const onOpen = vi.fn()
    render(<ResultCard to="/tokens/8" title="goblin.png" subtitle="Tokens" onOpen={onOpen} />)

    await userEvent.pointer({ target: screen.getByText('goblin.png'), keys: '[MouseMiddle]' })

    expect(open).toHaveBeenCalledWith('/tokens/8', '_blank', 'noopener,noreferrer')
    expect(onOpen).not.toHaveBeenCalled()
  })
})
