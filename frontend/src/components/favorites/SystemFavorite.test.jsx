import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SystemFavorite from './SystemFavorite'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
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

describe('SystemFavorite', () => {
  it('renders the name in grid mode and navigates on click', async () => {
    render(<SystemFavorite item={item()} grid />)
    expect(screen.getByText('Dungeons & Dragons')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Dungeons & Dragons'))
    expect(navigate).toHaveBeenCalledWith('/library/system/s1')
  })

  it('renders in row mode and navigates on click', async () => {
    render(<SystemFavorite item={item()} grid={false} />)
    await userEvent.click(screen.getByText('Dungeons & Dragons'))
    expect(navigate).toHaveBeenCalledWith('/library/system/s1')
  })

  it('joins publisher names when present', () => {
    render(<SystemFavorite item={item({ publishers: [{ name: 'WotC' }, { name: 'TSR' }] })} grid />)
    expect(screen.getByText('WotC, TSR')).toBeInTheDocument()
  })

  it('renders the cover thumbnail (lazy) when cover_book_id is set', () => {
    const { container } = render(<SystemFavorite item={item({ cover_book_id: 'b9' })} grid />)
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toContain('/books/b9/thumbnail')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('falls back to an icon when there is no cover', () => {
    const { container } = render(<SystemFavorite item={item()} grid={false} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
