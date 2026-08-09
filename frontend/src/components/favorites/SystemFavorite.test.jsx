import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SystemFavorite from './SystemFavorite'

vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))
vi.mock('../FavoriteButton', () => ({ default: () => <button>fav</button> }))

beforeEach(() => vi.clearAllMocks())

const item = (over = {}) => ({
  item_id: 's1',
  name: 'Dungeons & Dragons',
  cover_book_id: null,
  publishers: [],
  ...over,
})

function renderSystem(props) {
  return render(
    <MemoryRouter>
      <SystemFavorite {...props} />
    </MemoryRouter>
  )
}

describe('SystemFavorite', () => {
  it('renders the name in grid mode as a real link', () => {
    renderSystem({ item: item(), grid: true })
    expect(screen.getByText('Dungeons & Dragons')).toBeInTheDocument()
    // CardLink renders a real anchor; middle-click / ctrl-click works natively.
    const link = screen.getByRole('link', { name: 'Dungeons & Dragons' })
    expect(link).toHaveAttribute('href', '/library/system/s1')
  })

  it('renders in row mode as a real link', () => {
    renderSystem({ item: item(), grid: false })
    const link = screen.getByRole('link', { name: 'Dungeons & Dragons' })
    expect(link).toHaveAttribute('href', '/library/system/s1')
  })

  it('joins publisher names when present', () => {
    renderSystem({ item: item({ publishers: [{ name: 'WotC' }, { name: 'TSR' }] }), grid: true })
    expect(screen.getByText('WotC, TSR')).toBeInTheDocument()
  })

  it('renders the cover thumbnail (lazy) when cover_book_id is set', () => {
    const { container } = renderSystem({ item: item({ cover_book_id: 'b9' }), grid: true })
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toContain('/books/b9/thumbnail')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('falls back to an icon when there is no cover', () => {
    const { container } = renderSystem({ item: item(), grid: false })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
